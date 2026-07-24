import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudio } from '@/lib/gemini'
import { transcribeAudioGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { rateLimit } from '@/lib/rateLimit'
import { logToSink } from '@/lib/firestore/systemLogs'

// Recordings are transcribed live in short (~4 min) segments, so each request
// handles only a small independent audio file that finishes in a few seconds —
// well within the 60s Hobby ceiling regardless of the total session length.
export const maxDuration = 60

const MAX_SEGMENT_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let uid = 'unknown'
  let seg = '?'
  try {
    const form = await req.formData()
    const audio = form.get('audio')
    const mimeType = form.get('mimeType')
    const uidField = form.get('uid')
    const segField = form.get('segIndex')
    uid = typeof uidField === 'string' ? uidField : 'unknown'
    seg = typeof segField === 'string' ? segField : '?'

    if (!uidField || typeof uidField !== 'string' || uidField.length === 0 || uidField.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'Invalid audio field' }, { status: 400 })
    }
    if (typeof mimeType !== 'string' || !mimeType.startsWith('audio/') || mimeType.length > 100) {
      return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 })
    }

    const limit = rateLimit(`${uidField}:transcribe`, 120, 60 * 60 * 1000)
    if (!limit.allowed) {
      logToSink({ level: 'warn', tag: 'transcribe', message: 'rate limit exceeded', route: '/api/transcribe', status: 429, uid: uidField })
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    const buffer = Buffer.from(await audio.arrayBuffer())
    if (buffer.length > MAX_SEGMENT_BYTES) {
      return NextResponse.json({ error: 'Audio segment too large' }, { status: 413 })
    }
    const sizeMB = Math.round((buffer.length / (1024 * 1024)) * 100) / 100
    const base64 = buffer.toString('base64')

    // 1. The user's OWN Gemini key — their generous per-account limits. No shared
    //    server key / 20-per-day pool is used, so a long session never exhausts a
    //    quota mid-recording.
    const userGeminiKey = req.headers.get('x-gemini-key')
    if (userGeminiKey) {
      try {
        const { text } = await transcribeAudio(base64, mimeType, userGeminiKey)
        console.log(`[transcribe] ok provider=gemini seg=${seg} uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
        return NextResponse.json({ text, provider: 'gemini' })
      } catch (err) {
        console.error(`[transcribe] gemini failed seg=${seg} uid=${uid} sizeMB=${sizeMB}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 2. Groq fallback.
    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No transcription key. Add your Gemini API key (or a Groq key) in Settings → API Keys.' }, { status: 401 })
    }
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'bin'
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), `audio.${ext}`)
    try {
      const text = await transcribeAudioGroq(formData, groqKey)
      console.log(`[transcribe] ok provider=groq seg=${seg} uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
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
