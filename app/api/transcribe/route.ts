import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudioViaFilesApi, checkQuota, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { transcribeAudioGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles'
import { adminStorage } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'

// Transcribing a full recording in one Gemini call takes far longer than
// Vercel's 10s Hobby default. This requests 300s (the Pro ceiling); on the
// Hobby plan Vercel silently clamps it to 60s, which is why recordings longer
// than ~40 min time out on Hobby. Long sessions need the Pro plan.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  let recordingPath: string | null = null
  let succeeded = false
  let sizeMB = 0
  let uid = 'unknown'
  try {
    const body = await req.json() as {
      uid?: string
      storagePath?: string
      mimeType?: string
    }
    const storagePath = body.storagePath
    const mimeType = body.mimeType
    uid = body.uid ?? 'unknown'

    if (!body.uid || typeof body.uid !== 'string' || body.uid.length === 0 || body.uid.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }
    if (!mimeType || typeof mimeType !== 'string' || !mimeType.startsWith('audio/') || mimeType.length > 100) {
      return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 })
    }
    // Bind the recording to the caller's own folder and reject path traversal
    const expectedPrefix = `recordings/${body.uid}/`
    if (!storagePath || typeof storagePath !== 'string' || !storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
      return NextResponse.json({ error: 'Invalid storagePath' }, { status: 400 })
    }

    const limit = rateLimit(`${body.uid}:transcribe`, 30, 60 * 60 * 1000)
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    recordingPath = storagePath
    const file = adminStorage().bucket().file(storagePath)
    const [exists] = await file.exists()
    if (!exists) {
      return NextResponse.json({ error: 'Recording not found. Please try recording again.' }, { status: 404 })
    }
    const [buffer] = await file.download()
    sizeMB = Math.round((buffer.length / (1024 * 1024)) * 10) / 10

    const profile = await getProfile(uid).catch(() => null)

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const { text, totalTokens } = await transcribeAudioViaFilesApi(buffer, mimeType)
          succeeded = true
          console.log(`[transcribe] ok provider=gemini uid=${uid} sizeMB=${sizeMB} chars=${text.length} elapsedMs=${Date.now() - startedAt}`)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
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
      succeeded = true
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
    console.error(`[transcribe] error uid=${uid} sizeMB=${sizeMB} elapsedMs=${Date.now() - startedAt}: ${msg}`)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  } finally {
    // Delete the audio ONLY after a successful transcription. On failure the
    // recording is kept so the session can be recovered / retried without
    // re-recording — a Storage lifecycle rule on recordings/ purges leftovers.
    // (Note: a hard function timeout kills the runtime before this runs, which
    // is itself why a timed-out recording survives in Storage.)
    if (recordingPath && succeeded) {
      adminStorage().bucket().file(recordingPath).delete().catch(() => {})
    }
  }
}
