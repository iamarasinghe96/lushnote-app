import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudioViaFilesApi, checkQuota, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { transcribeAudioGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles'
import { adminStorage } from '@/lib/firebase-admin'
import { rateLimit } from '@/lib/rateLimit'

// Transcribing a full recording in one Gemini call takes far longer than
// Vercel's 10s Hobby default. 60s is the Hobby-plan ceiling.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  let recordingPath: string | null = null
  try {
    const body = await req.json() as {
      uid?: string
      storagePath?: string
      mimeType?: string
    }
    const { uid, storagePath, mimeType } = body

    if (!uid || typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }
    if (!mimeType || typeof mimeType !== 'string' || !mimeType.startsWith('audio/') || mimeType.length > 100) {
      return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 })
    }
    // Bind the recording to the caller's own folder and reject path traversal
    const expectedPrefix = `recordings/${uid}/`
    if (!storagePath || typeof storagePath !== 'string' || !storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
      return NextResponse.json({ error: 'Invalid storagePath' }, { status: 400 })
    }

    const limit = rateLimit(`${uid}:transcribe`, 30, 60 * 60 * 1000)
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

    const profile = await getProfile(uid).catch(() => null)

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const { text, totalTokens } = await transcribeAudioViaFilesApi(buffer, mimeType)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
          return NextResponse.json({ text, provider: 'gemini' })
        } catch (err) {
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
      return NextResponse.json({ text, provider: 'groq' })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('429:')) {
        const waitSeconds = parseGroqWaitSeconds(err.message)
        return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
      }
      return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
    }
  } catch {
    console.error('Transcription error')
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  } finally {
    // Audio is never retained: delete the uploaded recording immediately,
    // whether transcription succeeded or failed.
    if (recordingPath) {
      adminStorage().bucket().file(recordingPath).delete().catch(() => {})
    }
  }
}
