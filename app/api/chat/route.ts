import { NextRequest, NextResponse } from 'next/server'
import { chatResponse, checkQuota } from '@/lib/gemini'
import { generateNoteGroq } from '@/lib/groq'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles'

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt, uid } = await req.json() as {
      messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>
      systemPrompt: string
      uid: string
    }

    if (!messages || !uid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const profile = await getProfile(uid)

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'chat')) {
        try {
          const reply = await chatResponse(messages, systemPrompt)
          await updateGeminiUsage(uid, 'chat')
          return NextResponse.json({ reply, provider: 'gemini' })
        } catch {
          // fall through to Groq
        }
      }
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No API key available for chat' }, { status: 401 })
    }

    // Convert Gemini message format to Groq/OpenAI format
    const groqMessages = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' as const : 'user' as const,
      content: m.parts[0].text,
    }))

    const prompt = groqMessages.map(m => m.content).join('\n')
    const reply = await generateNoteGroq(prompt, systemPrompt, groqKey)
    return NextResponse.json({ reply, provider: 'groq' })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
