import { NextRequest, NextResponse } from 'next/server'
import { chatResponse, checkQuota, GEMINI_RATE_LIMIT_ERROR } from '@/lib/gemini'
import { generateNoteGroq } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles'
import { rateLimit } from '@/lib/rateLimit'

const TRANSCRIPT_QA_SYSTEM_PROMPT = `You are a clinical documentation assistant. The user is a psychiatrist reviewing a session transcript.
Answer questions using ONLY information explicitly present in the transcript below.
Do not infer, assume, or fabricate any clinical information.
If the answer is not clearly stated, say so honestly.
If making a reasonable inference (not directly stated), mark it clearly as inferred.

Respond ONLY in this exact JSON format with no other text:
{
  "found": true or false,
  "inferred": true or false,
  "answer": "Your answer here",
  "quote": "Exact words from transcript supporting this, or empty string"
}

TRANSCRIPT:
{transcript}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>
    const { type } = body

    // ── AI Assistant (FAB chat) ─────────────────────────────────────────────────
    if (type === 'assistant') {
      const { question, kb, uid } = body as {
        question: string
        kb?: string
        uid?: string
      }

      if (!question || typeof question !== 'string' || question.length > 2000) {
        return NextResponse.json({ error: 'Invalid question' }, { status: 400 })
      }

      const systemPrompt = `You are the LushNote AI assistant. Help users understand and use LushNote.
Use the following knowledge base to answer questions accurately:

${kb ?? ''}

If the user asks about a specific patient or clinical scenario and there is no patient context provided,
explain that you can search their notes if they share more details.
Keep responses concise and practical.`

      const messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [
        { role: 'user', parts: [{ text: question }] },
      ]

      if (process.env.GEMINI_API_KEY) {
        try {
          const { text: answer, totalTokens } = await chatResponse(messages, systemPrompt)
          if (uid && typeof uid === 'string') {
            await updateGeminiUsage(uid, 'chat', totalTokens).catch(() => {})
          }
          return NextResponse.json({ answer, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_RATE_LIMIT_ERROR && typeof uid === 'string') {
            await markGeminiLimitReached(uid, 'chat').catch(() => {})
          }
          // fall through to Groq
        }
      }

      const groqKey = req.headers.get('x-groq-key')
      if (!groqKey) {
        return NextResponse.json({ error: 'No API key available' }, { status: 401 })
      }
      const { content: answer } = await generateNoteGroq(question, systemPrompt, groqKey)
      return NextResponse.json({ answer, provider: 'groq' })
    }

    // ── Transcript Q&A ──────────────────────────────────────────────────────────
    if (type === 'transcript-qa') {
      const { question, transcript, uid } = body as {
        question: string
        transcript: string
        uid?: string
      }

      if (!question || typeof question !== 'string' || question.length > 2000) {
        return NextResponse.json({ error: 'Invalid question' }, { status: 400 })
      }
      if (!transcript || typeof transcript !== 'string' || transcript.length > 50000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }

      const systemPrompt = TRANSCRIPT_QA_SYSTEM_PROMPT.replace('{transcript}', transcript)
      const messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [
        { role: 'user', parts: [{ text: question }] },
      ]

      if (process.env.GEMINI_API_KEY) {
        try {
          const { text: answer, totalTokens } = await chatResponse(messages, systemPrompt)
          if (uid && typeof uid === 'string') {
            await updateGeminiUsage(uid, 'chat', totalTokens).catch(() => {})
          }
          return NextResponse.json({ answer, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_RATE_LIMIT_ERROR && typeof uid === 'string') {
            await markGeminiLimitReached(uid, 'chat').catch(() => {})
          }
          // fall through to Groq
        }
      }

      const groqKey = req.headers.get('x-groq-key')
      if (!groqKey) {
        return NextResponse.json({ error: 'No API key available' }, { status: 401 })
      }
      const { content: answer } = await generateNoteGroq(question, systemPrompt, groqKey)
      return NextResponse.json({ answer, provider: 'groq' })
    }

    // ── Custom field standardize ────────────────────────────────────────────────
    if (type === 'standardize') {
      const { rawInput, prompt: fieldPrompt, uid } = body as {
        rawInput?: string
        prompt?: string
        uid?: string
      }

      if (!rawInput || typeof rawInput !== 'string' || rawInput.length > 5000) {
        return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
      }

      const systemPrompt = [
        'You are a clinical documentation assistant. A doctor has entered raw notes for a custom clinical section.',
        fieldPrompt ? `Instructions for this section: ${fieldPrompt}` : '',
        '',
        'Rewrite the raw notes as polished, professional clinical text suitable for a medical record.',
        'Use clear, concise clinical language. Maintain all clinical facts. Do not add information not present.',
        'Output only the standardised clinical text - no preamble, no explanation, no labels.',
      ].filter(Boolean).join('\n')

      if (process.env.GEMINI_API_KEY) {
        try {
          const msgs: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [{ role: 'user', parts: [{ text: rawInput }] }]
          const { text: result } = await chatResponse(msgs, systemPrompt)
          if (uid && typeof uid === 'string') await updateGeminiUsage(uid, 'chat', 0).catch(() => {})
          return NextResponse.json({ result, provider: 'gemini' })
        } catch { /* fall through to Groq */ }
      }

      const groqKey = req.headers.get('x-groq-key')
      if (!groqKey) return NextResponse.json({ error: 'No API key available' }, { status: 401 })
      const { content: result } = await generateNoteGroq(rawInput, systemPrompt, groqKey)
      return NextResponse.json({ result, provider: 'groq' })
    }

    // ── Standard chat ───────────────────────────────────────────────────────────
    const { messages, systemPrompt, uid } = body as {
      messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>
      systemPrompt: string
      uid: string
    }

    if (!uid || typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      return NextResponse.json({ error: 'Invalid messages array' }, { status: 400 })
    }

    for (const msg of messages) {
      if ((msg.role !== 'user' && msg.role !== 'model') || !Array.isArray(msg.parts)) {
        return NextResponse.json({ error: 'Invalid message format' }, { status: 400 })
      }
    }

    const limit = rateLimit(`${uid}:chat`, 60, 60 * 60 * 1000)
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    const profile = await getProfile(uid)

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'chat')) {
        try {
          const { text: reply, totalTokens } = await chatResponse(messages, systemPrompt)
          await updateGeminiUsage(uid, 'chat', totalTokens)
          return NextResponse.json({ reply, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_RATE_LIMIT_ERROR && typeof uid === 'string') {
            await markGeminiLimitReached(uid, 'chat').catch(() => {})
          }
          // fall through to Groq
        }
      }
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No API key available for chat' }, { status: 401 })
    }

    const groqMessages = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' as const : 'user' as const,
      content: m.parts[0].text,
    }))

    const prompt = groqMessages.map(m => m.content).join('\n')
    const { content: reply } = await generateNoteGroq(prompt, systemPrompt, groqKey)
    return NextResponse.json({ reply, provider: 'groq' })

  } catch {
    console.error('Chat error')
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}
