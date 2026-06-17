import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudio, checkQuota } from '@/lib/gemini'
import { transcribeAudioGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio = form.get('audio')
    const mimeType = form.get('mimeType')
    const uid = form.get('uid')

    if (!uid || typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }

    if (!(audio instanceof File)) {
      return NextResponse.json({ error: 'Invalid audio field' }, { status: 400 })
    }

    if (typeof mimeType !== 'string' || !mimeType.startsWith('audio/')) {
      return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 })
    }

    const limit = rateLimit(`${uid}:transcribe`, 30, 60 * 60 * 1000)
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    const profile = await getProfile(uid).catch(() => null)
    const arrayBuffer = await audio.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const { text, totalTokens } = await transcribeAudio(base64, mimeType)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
          return NextResponse.json({ text, provider: 'gemini' })
        } catch {
          // fall through to Groq
        }
      }
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No API key available for transcription' }, { status: 401 })
    }

    const formData = new FormData()
    formData.append('file', audio, 'audio.webm')
    try {
      const text = await transcribeAudioGroq(formData, groqKey)
      return NextResponse.json({ text, provider: 'groq' })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('429:')) {
        const waitSeconds = parseGroqWaitSeconds(err.message)
        return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
      }
      const msg = err instanceof Error ? err.message : 'Transcription failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

  } catch {
    console.error('Transcription error')
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
