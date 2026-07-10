import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudio, checkQuota, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { transcribeAudioGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles'
import { rateLimit } from '@/lib/rateLimit'

// Recordings are transcribed live in short (~4 min) segments, so each request
// handles only a small independent audio file that finishes in a few seconds.
// This keeps every call well within the 60s Hobby ceiling no matter how long
// the overall session is — long recordings never hit the timeout because the
// server never sees more than one segment at a time.
export const maxDuration = 60

const MAX_SEGMENT_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let uid = 'unknown'
  try {
    const form = await req.formData()
    const audio = form.get('audio')
    const mimeType = form.get('mimeType')
    const uidField = form.get('uid')
    uid = typeof uidField === 'string' ? uidField : 'unknown'

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
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    const buffer = Buffer.from(await audio.arrayBuffer())
    if (buffer.length > MAX_SEGMENT_BYTES) {
      return NextResponse.json({ error: 'Audio segment too large' }, { status: 413 })
    }
    const sizeMB = Math.round((buffer.length / (1024 * 1024)) * 100) / 100

    const profile = await getProfile(uid).catch(() => null)

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const base64 = buffer.toString('base64')
          const { text, totalTokens } = await transcribeAudio(base64, mimeType)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
          console.log(`[transcribe] ok provider=gemini uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
          return NextResponse.json({ text, provider: 'gemini' })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[transcribe] gemini failed uid=${uid} sizeMB=${sizeMB} elapsedMs=${Date.now() - startedAt}: ${msg}`)
          if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
            await markGeminiLimitReached(uid, 'gemini-2.5-flash').catch(() => {})
          }
          // fall through to Groq
        }
      }
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No API key available for transcription' }, { status: 401 })
    }

    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'bin'
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), `audio.${ext}`)
    try {
      const text = await transcribeAudioGroq(formData, groqKey)
      console.log(`[transcribe] ok provider=groq uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
      return NextResponse.json({ text, provider: 'groq' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[transcribe] groq failed uid=${uid} sizeMB=${sizeMB} elapsedMs=${Date.now() - startedAt}: ${msg}`)
      if (err instanceof Error && err.message.startsWith('429:')) {
        const waitSeconds = parseGroqWaitSeconds(err.message)
        return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
      }
      return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[transcribe] error uid=${uid} elapsedMs=${Date.now() - startedAt}: ${msg}`)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
