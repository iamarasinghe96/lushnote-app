import { NextRequest, NextResponse } from 'next/server'
import { withRequest, noteRequest } from '@/lib/requestContext'
import { mockForCaller, mockTranscribeResponse } from '@/lib/e2eMock'
import { transcribeAudio } from '@/lib/gemini'
import { transcribeAudioGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { rateLimit } from '@/lib/rateLimit'
import { logToSink } from '@/lib/firestore/systemLogs'
import { resolveAiKeys, proGeminiKey, sharedGroqKey } from '@/lib/serverAiKeys'
import { recordAiSpend } from '@/lib/firestore/profiles-admin'
import { requireUser, unauthorized } from '@/lib/adminGuard'
import { geminiCostMicros, whisperCostMicros, audioSecondsFromBytes } from '@/lib/aiCost'
import { getProfile } from '@/lib/firestore/profiles-admin'
import { getAccessState } from '@/lib/billing'

// Recordings are transcribed live in short (~4 min) segments, so each request
// handles only a small independent audio file that finishes in a few seconds —
// well within the 60s Hobby ceiling regardless of the total session length.
export const maxDuration = 60

const MAX_SEGMENT_BYTES = 8 * 1024 * 1024

async function handlePOST(req: NextRequest) {
  const startedAt = Date.now()
  let uid = 'unknown'
  let seg = '?'
  try {
    // Identity is PROVEN here, not asserted - see the note in /api/generate.
    // The form's own uid field is ignored entirely; `uidField` is kept as the
    // name the rest of this handler already uses.
    let uidField: string
    try { uidField = await requireUser(req) } catch { return unauthorized() }
    uid = uidField
    noteRequest({ uid })

    const form = await req.formData()
    const audio = form.get('audio')
    const mimeType = form.get('mimeType')
    const segField = form.get('segIndex')
    seg = typeof segField === 'string' ? segField : '?'
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'Invalid audio field' }, { status: 400 })
    }
    if (typeof mimeType !== 'string' || !mimeType.startsWith('audio/') || mimeType.length > 100) {
      return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 })
    }

    // Preview deployments only, and never production — see lib/e2eMock.
    if (mockForCaller(await getProfile(uidField).catch(() => null))) {
      logToSink({ level: 'info', tag: 'transcribe', route: '/api/transcribe', uid: uidField, message: 'mocked reply' })
      return NextResponse.json(mockTranscribeResponse())
    }

    const limit = rateLimit(`${uidField}:transcribe`, 120, 60 * 60 * 1000)
    if (!limit.allowed) {
      logToSink({ level: 'warn', tag: 'transcribe', message: 'rate limit exceeded', route: '/api/transcribe', status: 429, uid: uidField })
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    // The only AI route with no suspension check until now, and the one a
    // recording calls most: a session is transcribed segment by segment, so a
    // doctor whose account is gone would otherwise keep spending the key for
    // the length of a consultation.
    const access = await getAccessState(uidField)
    if (access.suspended) {
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 })
    }
    if (!access.entitlement.entitled) {
      logToSink({ level: 'info', tag: 'billing', route: '/api/transcribe', uid: uidField, status: 402, message: `blocked: ${access.entitlement.reason}` })
      return NextResponse.json({ error: 'Your LushNote subscription needs attention - note creation is paused. Open Billing to restore access.', code: 'subscription_required', state: access.entitlement.state }, { status: 402 })
    }

    // Who pays for this call. A paying doctor is served by LushNote's keys; a
    // trial doctor by their own, which is what the upgrade actually buys.
    const keys = resolveAiKeys({
      state: access.entitlement.state,
      monthSpendMicros: access.monthSpendMicros,
      userGeminiKey: req.headers.get('x-gemini-key'),
      userGroqKey: req.headers.get('x-groq-key'),
      proGeminiKey: proGeminiKey(),
      sharedGroqKey: sharedGroqKey(),
    })

    const buffer = Buffer.from(await audio.arrayBuffer())
    if (buffer.length > MAX_SEGMENT_BYTES) {
      return NextResponse.json({ error: 'Audio segment too large' }, { status: 413 })
    }
    const sizeMB = Math.round((buffer.length / (1024 * 1024)) * 100) / 100
    const base64 = buffer.toString('base64')

    // 1. The user's OWN Gemini key — their generous per-account limits. No shared
    //    server key / 20-per-day pool is used, so a long session never exhausts a
    //    quota mid-recording.
    const userGeminiKey = keys.geminiKey
    if (userGeminiKey) {
      try {
        const { text, usage } = await transcribeAudio(base64, mimeType, userGeminiKey)
        // Audio arrives INSIDE promptTokenCount, so it is handed over separately
        // and subtracted before the text rate is applied - otherwise the most
        // expensive line in the whole product is billed twice.
        void recordAiSpend(uidField, {
          micros: geminiCostMicros(usage, 'gemini-2.5-flash', usage.prompt),
          provider: 'gemini',
        }).catch(() => {})
        console.log(`[transcribe] ok provider=gemini seg=${seg} uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
        return NextResponse.json({ text, provider: 'gemini' })
      } catch (err) {
        console.error(`[transcribe] gemini failed seg=${seg} uid=${uid} sizeMB=${sizeMB}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 2. Groq fallback — the doctor's own key, else LushNote's.
    //
    // The shared key is what makes an exhausted Gemini day a change of provider
    // rather than a stop in work. A doctor mid-consultation whose 20 requests
    // are spent used to lose transcription for every remaining segment; the
    // audio survived (it is uploaded before this runs) but the session was
    // unusable until the quota reset the next day.
    const groqKey = keys.groqKey
    const groq = { shared: keys.sharedGroq }
    if (!groqKey) {
      return NextResponse.json({ error: 'No transcription key. Add your Gemini API key (or a Groq key) in Settings → API Keys.' }, { status: 401 })
    }
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'bin'
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), `audio.${ext}`)
    try {
      const text = await transcribeAudioGroq(formData, groqKey)
      // Whisper bills per hour and the reply is a bare string, so the duration
      // is estimated from the encoded size at the recorder's pinned bitrate.
      // See audioSecondsFromBytes for why the response format was left alone.
      void recordAiSpend(uidField, {
        micros: whisperCostMicros(audioSecondsFromBytes(buffer.length)),
        provider: 'groq',
      }).catch(() => {})
      console.log(`[transcribe] ok provider=groq shared=${groq.shared} seg=${seg} uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
      // Only the shared path is logged to the sink: a doctor using their own key
      // is unremarkable, while every request on ours is a cost we should be able
      // to count without reading server logs.
      if (groq.shared) logToSink({ level: 'info', tag: 'shared-groq', route: '/api/transcribe', uid, message: 'transcribed on the shared key' })
      return NextResponse.json({ text, provider: 'groq' })
    } catch (err) {
      console.error(`[transcribe] groq failed seg=${seg} uid=${uid} sizeMB=${sizeMB}: ${err instanceof Error ? err.message : String(err)}`)
      if (err instanceof Error && err.message.startsWith('429:')) {
        const waitSeconds = parseGroqWaitSeconds(err.message)
        return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
      }
      return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[transcribe] error seg=${seg} uid=${uid} elapsedMs=${Date.now() - startedAt}: ${msg}`)
    logToSink({ level: 'error', tag: 'transcribe', message: msg, route: '/api/transcribe', status: 500, uid })
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}

// Every line logged inside this handler shares one request id, so a doctor's
// single click reads as one story instead of scattered lines to correlate by
// timestamp.
export function POST(req: NextRequest) {
  return withRequest('/api/transcribe', () => handlePOST(req))
}
