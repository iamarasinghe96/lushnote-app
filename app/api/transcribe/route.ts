import { NextRequest, NextResponse } from 'next/server'
import { transcribeAudio, checkQuota } from '@/lib/gemini'
import { transcribeAudioGroq } from '@/lib/groq'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio = form.get('audio') as File | null
    const mimeType = form.get('mimeType') as string | null
    const uid = form.get('uid') as string | null

    if (!audio || !mimeType || !uid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const profile = await getProfile(uid)
    const arrayBuffer = await audio.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'transcribe')) {
        try {
          const text = await transcribeAudio(base64, mimeType)
          await updateGeminiUsage(uid, 'transcribe')
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
    const text = await transcribeAudioGroq(formData, groqKey)
    return NextResponse.json({ text, provider: 'groq' })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
