import { NextRequest, NextResponse } from 'next/server'
import { generateNote, checkQuota } from '@/lib/gemini'
import { generateNoteGroq } from '@/lib/groq'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles'

export async function POST(req: NextRequest) {
  try {
    const { transcript, templatePrompt, systemPrompt, uid } = await req.json() as {
      transcript: string
      templatePrompt: string
      systemPrompt: string
      uid: string
    }

    if (!transcript || !uid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const profile = await getProfile(uid)
    const prompt = `${templatePrompt}\n\n${transcript}`

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'generate')) {
        try {
          const content = await generateNote(prompt, systemPrompt)
          await updateGeminiUsage(uid, 'generate')
          return NextResponse.json({ content, provider: 'gemini' })
        } catch {
          // fall through to Groq
        }
      }
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No API key available for generation' }, { status: 401 })
    }

    const content = await generateNoteGroq(prompt, systemPrompt, groqKey)
    return NextResponse.json({ content, provider: 'groq' })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
