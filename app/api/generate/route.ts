import { NextRequest, NextResponse } from 'next/server'
import { generateNote, checkQuota } from '@/lib/gemini'
import { generateNoteGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      transcript: string
      templatePrompt: string
      systemPrompt: string
      uid: string
    }

    const { transcript, templatePrompt, systemPrompt, uid } = body

    if (!uid || typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }

    if (!transcript || typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 100000) {
      return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
    }

    if (!templatePrompt || typeof templatePrompt !== 'string' || templatePrompt.length === 0 || templatePrompt.length > 50000) {
      return NextResponse.json({ error: 'Invalid templatePrompt' }, { status: 400 })
    }

    if (typeof systemPrompt !== 'string' || systemPrompt.length > 10000) {
      return NextResponse.json({ error: 'Invalid systemPrompt' }, { status: 400 })
    }

    const limit = rateLimit(`${uid}:generate`, 40, 60 * 60 * 1000)
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
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

    try {
      const content = await generateNoteGroq(prompt, systemPrompt, groqKey)
      return NextResponse.json({ content, provider: 'groq' })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('429:')) {
        const waitSeconds = parseGroqWaitSeconds(err.message)
        return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
      }
      throw err
    }

  } catch {
    console.error('Generation error')
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
