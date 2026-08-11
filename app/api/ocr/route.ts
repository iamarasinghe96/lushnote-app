import { NextRequest, NextResponse } from 'next/server'
import { ocrClinicalImages, checkQuota, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles-admin'
import { rateLimit } from '@/lib/rateLimit'
import { logToSink } from '@/lib/firestore/systemLogs'

// Reading a photographed ward note is a single Gemini call on an image already
// downscaled by the client, so it finishes well inside the Hobby ceiling.
export const maxDuration = 60

// The photo is held in memory for the length of this request and nothing else:
// it is never written to Storage, Firestore or a log line. Only the transcribed
// text goes back to the client.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_IMAGES = 4

const AI_LIMIT_MESSAGE = 'Dear doctor — our free AI usage limit has been reached for now. Please try again later today, or tomorrow. To keep working straight away, add your own Gemini API key in Settings → API Keys.'

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

export async function POST(req: NextRequest) {
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
    let raw: string | null = null

    if (userGeminiKey) {
      try {
        const { text, totalTokens } = await ocrClinicalImages(images, userGeminiKey)
        raw = text
        await updateGeminiUsage(uidField, 'gemini-2.5-flash', totalTokens).catch(() => {})
      } catch { /* fall through to the shared key */ }
    }

    if (raw === null && process.env.GEMINI_API_KEY && checkQuota(profile?.geminiUsage ?? {}, 'gemini-2.5-flash')) {
      try {
        const { text, totalTokens } = await ocrClinicalImages(images)
        raw = text
        await updateGeminiUsage(uidField, 'gemini-2.5-flash', totalTokens).catch(() => {})
      } catch (err) {
        if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
          await markGeminiLimitReached(uidField, 'gemini-2.5-flash').catch(() => {})
        }
      }
    }

    if (raw === null) {
      logToSink({ level: 'warn', tag: 'ocr', message: 'no provider available', route: '/api/ocr', status: 429, uid: uidField })
      return NextResponse.json({ error: AI_LIMIT_MESSAGE }, { status: 429 })
    }

    let parsed: OcrReply
    try {
      parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()) as OcrReply
    } catch {
      logToSink({ level: 'warn', tag: 'ocr', message: 'reply was not valid JSON', route: '/api/ocr', uid: uidField })
      return NextResponse.json({ error: 'Could not read that photo. Try again with a clearer, straight-on shot.' }, { status: 502 })
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
