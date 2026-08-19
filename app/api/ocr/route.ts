import { NextRequest, NextResponse } from 'next/server'
import { withRequest, noteRequest } from '@/lib/requestContext'
import { ocrClinicalImages, checkQuota, GEMINI_DAILY_LIMIT_ERROR, GEMINI_KEY_INVALID_ERROR, GEMINI_RATE_LIMIT_ERROR, GEMINI_OVERLOADED_ERROR, describeGeminiError } from '@/lib/gemini'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles-admin'
import { rateLimit } from '@/lib/rateLimit'
import { logToSink } from '@/lib/firestore/systemLogs'
import { resolveEntitlement } from '@/lib/entitlement'

// Reading a photographed ward note is a single Gemini call on an image already
// downscaled by the client, so it finishes well inside the Hobby ceiling.
export const maxDuration = 60

// The photo is held in memory for the length of this request and nothing else:
// it is never written to Storage, Firestore or a log line. Only the transcribed
// text goes back to the client.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_IMAGES = 4

const AI_LIMIT_MESSAGE = 'Dear doctor — our free AI usage limit has been reached for now. Please try again later today, or tomorrow. To keep working straight away, add your own Gemini API key in Settings → API Keys.'

// Every way the doctor's OWN key can fail, each said plainly. Anything left
// unmapped used to surface as "our free AI usage limit has been reached", which
// sent a doctor whose key was merely being called too fast off to wait a day.
function keyFailureMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : ''
  if (m === GEMINI_KEY_INVALID_ERROR) return 'Google rejected your Gemini API key. Open Settings → API Keys and paste it again, or create a new key at aistudio.google.com.'
  if (m === GEMINI_DAILY_LIMIT_ERROR) return 'Your Gemini API key has reached its daily limit with Google. It resets at midnight US Pacific time.'
  if (m === GEMINI_RATE_LIMIT_ERROR) return 'Google is throttling your Gemini key — its free tier allows only a few requests per minute, and reading a page takes several. Wait about a minute and scan again.'
  if (m === GEMINI_OVERLOADED_ERROR) return 'Google reported that Gemini is busy right now — nothing is wrong with your key or your quota. Wait a minute and scan again.'
  return `Gemini could not be reached with your key (${m || 'unknown error'}). Try again in a moment.`
}

interface OcrReply {
  patientName?: string
  urNumber?: string
  dob?: string
  sex?: string
  sections?: { heading?: string; lines?: unknown[] }[]
  text?: string
}

// The model answers with one block per written section. Enumerating the page
// that way is what stops it reading the long Progress paragraph and skipping the
// problem list above it and the numbered plan below. `text` is the older
// free-form shape, still accepted.
// Headings the model named but returned no lines for.
function emptySections(parsed: OcrReply): string[] {
  if (!Array.isArray(parsed.sections)) return []
  return parsed.sections
    .filter(s => String(s.heading ?? '').trim() && !(Array.isArray(s.lines) && s.lines.some(l => String(l ?? '').trim())))
    .map(s => String(s.heading).trim())
}

function assembleText(parsed: OcrReply): string {
  if (Array.isArray(parsed.sections) && parsed.sections.length) {
    return parsed.sections
      .map(s => {
        const heading = String(s.heading ?? '').trim()
        const lines = Array.isArray(s.lines)
          ? s.lines.map(l => String(l ?? '').trim()).filter(Boolean)
          : []
        if (!heading && !lines.length) return ''
        return [heading, ...lines].filter(Boolean).join('\n')
      })
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }
  return (parsed.text ?? '').trim()
}

async function handlePOST(req: NextRequest) {
  let uid = 'unknown'
  try {
    const form = await req.formData()
    const uidField = form.get('uid')
    uid = typeof uidField === 'string' ? uidField : 'unknown'

    if (!uidField || typeof uidField !== 'string' || uidField.length === 0 || uidField.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }

    const files = form.getAll('images').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ error: 'No image supplied' }, { status: 400 })
    if (files.length > MAX_IMAGES) return NextResponse.json({ error: `Up to ${MAX_IMAGES} photos at a time.` }, { status: 400 })

    const limit = rateLimit(`${uidField}:ocr`, 60, 60 * 60 * 1000)
    if (!limit.allowed) {
      logToSink({ level: 'warn', tag: 'ocr', message: 'rate limit exceeded', route: '/api/ocr', status: 429, uid: uidField })
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    const profile = await getProfile(uidField).catch(() => null)
    if (profile?.status === 'disabled') {
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 })
    }

    // Paid features. 402 rather than 403: suspension is a judgement about the
    // person, this is only about the state of a subscription, and the client
    // routes the two differently.
    // The profile is already in hand from the suspension check, so resolve
    // from it rather than paying for a second read of the same document.
    const entitlement = resolveEntitlement(profile?.billing, Date.now())
    if (!entitlement.entitled) {
      logToSink({ level: 'info', tag: 'billing', route: '/api/ocr', uid: uid, status: 402, message: `blocked: ${entitlement.reason}` })
      return NextResponse.json({ error: 'Your LushNote subscription needs attention — note creation is paused. Open Billing to restore access.', code: 'subscription_required', state: entitlement.state }, { status: 402 })
    }

    const images: { data: string; mimeType: string }[] = []
    for (const f of files) {
      if (!f.type.startsWith('image/')) return NextResponse.json({ error: 'Only image files can be scanned.' }, { status: 400 })
      const buf = Buffer.from(await f.arrayBuffer())
      if (buf.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: 'Photo too large — try a smaller image.' }, { status: 413 })
      images.push({ data: buf.toString('base64'), mimeType: f.type })
    }

    // Gemini only: reading handwriting is a vision job, and the Groq fallback
    // models are text-only. The doctor's own key first — it is their quota, so it
    // is never gated — then the shared key while the daily pool lasts.
    const userGeminiKey = req.headers.get('x-gemini-key')
    let userKeyFailure: string | null = null

    const readPage = async (): Promise<OcrReply | null> => {
      const call = async (key?: string) => {
        const { text, usage } = await ocrClinicalImages(images, key)
        await updateGeminiUsage(uidField, 'gemini-2.5-flash', usage).catch(() => {})
        return text
      }
      let raw: string | null = null
      if (userGeminiKey) {
        try {
          raw = await call(userGeminiKey)
        } catch (err) {
          userKeyFailure = keyFailureMessage(err)
          logToSink({ level: 'warn', tag: 'gemini-key', route: '/api/ocr', uid: uidField, message: describeGeminiError(err) })
        }
      }
      if (raw === null && process.env.GEMINI_API_KEY
          && checkQuota(profile?.geminiUsage ?? {}, 'gemini-2.5-flash')) {
        try { raw = await call() } catch (err) {
          logToSink({ level: 'warn', tag: 'gemini-shared', route: '/api/ocr', uid: uidField, message: describeGeminiError(err) })
        }
      }
      if (raw === null) return null
      try {
        return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as OcrReply
      } catch {
        logToSink({ level: 'warn', tag: 'ocr', message: 'reply was not valid JSON', route: '/api/ocr', uid: uidField })
        return {}
      }
    }

    let parsed = await readPage()
    if (parsed === null) {
      // No key ever reached the server — a completely different problem from a
      // limit being reached, and the one message that used to cover both.
      if (!userGeminiKey && !process.env.GEMINI_API_KEY) {
        logToSink({ level: 'warn', tag: 'ocr', message: 'no gemini key sent', route: '/api/ocr', status: 401, uid: uidField })
        return NextResponse.json({
          error: 'No Gemini API key reached the server. Open Settings → API Keys, paste your key and press Save key, then try again.',
        }, { status: 401 })
      }
      logToSink({ level: 'warn', tag: 'ocr', message: userKeyFailure ? 'user gemini key failed' : 'no provider available', route: '/api/ocr', status: 429, uid: uidField })
      return NextResponse.json({ error: userKeyFailure ?? AI_LIMIT_MESSAGE }, { status: 429 })
    }

    // A section named but left empty is the model telling us it SAW a block and
    // did not transcribe it — exactly how a ward note's problem list went
    // missing while "Problem List" itself came through. Read the page again
    // rather than pass on a known hole.
    if (emptySections(parsed).length) {
      logToSink({ level: 'warn', tag: 'ocr', message: `empty sections: ${emptySections(parsed).join(', ')} — re-reading`, route: '/api/ocr', uid: uidField })
      const retry = await readPage()
      if (retry && (!emptySections(retry).length || assembleText(retry).length > assembleText(parsed).length)) parsed = retry
    }

    const text = assembleText(parsed)
    if (!text) {
      return NextResponse.json({ error: 'No text could be read from that photo. Try again with better lighting.' }, { status: 422 })
    }

    const sex = (parsed.sex ?? '').toLowerCase()
    return NextResponse.json({
      text,
      patient: {
        name: (parsed.patientName ?? '').trim(),
        urNumber: (parsed.urNumber ?? '').trim(),
        dob: (parsed.dob ?? '').trim(),
        gender: sex === 'male' || sex === 'female' ? sex : '',
      },
    })
  } catch (err) {
    logToSink({ level: 'error', tag: 'ocr', message: err instanceof Error ? err.message : 'unknown', route: '/api/ocr', status: 500, uid })
    return NextResponse.json({ error: 'Could not read that photo. Please try again.' }, { status: 500 })
  }
}

// Every line logged inside this handler shares one request id, so a doctor's
// single click reads as one story instead of scattered lines to correlate by
// timestamp.
export function POST(req: NextRequest) {
  return withRequest('/api/ocr', () => handlePOST(req))
}
