import { NextRequest, NextResponse } from 'next/server'
import { chatResponse, checkQuota, GEMINI_RATE_LIMIT_ERROR, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { generateNoteGroq } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles-admin'
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
      const { question, kb, uid, notesContext, history } = body as {
        question: string
        kb?: string
        uid?: string
        notesContext?: string
        history?: Array<{ role: string; content: string }>
      }

      if (!question || typeof question !== 'string' || question.length > 2000) {
        return NextResponse.json({ error: 'Invalid question' }, { status: 400 })
      }

      const safeNotes = typeof notesContext === 'string' ? notesContext.slice(0, 30000) : ''

      const systemPrompt = `You are the LushNote AI assistant for a psychiatrist. You have two jobs:

1. Help with the LushNote app itself, using this knowledge base:
${kb ?? ''}

2. Answer questions about the doctor's own patients using their clinical notes below. Each entry starts with the patient name, session date and diagnosis, followed by a summary and excerpts relevant to the question.

Rules for patient questions:
- Answer ONLY from the notes provided. Never fabricate clinical details.
- Identify patients by name, and include their registration number when the note
  has one, e.g. "Nellie (Reg: 20260715001)". Add the session date where relevant.
- Write each patient's name exactly as it appears in the notes so it can be linked.
- If several patients match, list each of them.
- For counting questions, count distinct patient names that match.
- If the notes provided do not contain the answer, say so plainly.

DOCTOR'S CLINICAL NOTES:
${safeNotes || '(no notes available)'}

Keep responses concise and practical.`

      const validHistory = Array.isArray(history)
        ? history
            .filter((h): h is { role: string; content: string } =>
              !!h && typeof h.role === 'string' && typeof h.content === 'string')
            .slice(-8)
            .map(h => `${h.role === 'user' ? 'Doctor' : 'Assistant'}: ${h.content.slice(0, 1500)}`)
            .join('\n')
        : ''

      const prompt = validHistory
        ? `Previous conversation:\n${validHistory}\n\nDoctor's question: ${question}`
        : question

      // Groq first - assistant queries are lightweight and must not burn the
      // shared Gemini quota that note generation depends on.
      const groqKey = req.headers.get('x-groq-key')
      if (groqKey) {
        try {
          const { content: answer } = await generateNoteGroq(prompt, systemPrompt, groqKey, 1024)
          return NextResponse.json({ answer, provider: 'groq' })
        } catch {
          // fall through to Gemini
        }
      }

      if (process.env.GEMINI_API_KEY) {
        try {
          const messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [
            { role: 'user', parts: [{ text: prompt }] },
          ]
          const { text: answer, totalTokens } = await chatResponse(messages, systemPrompt)
          if (uid && typeof uid === 'string') {
            await updateGeminiUsage(uid, 'chat', totalTokens).catch(() => {})
          }
          return NextResponse.json({ answer, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_RATE_LIMIT_ERROR && typeof uid === 'string') {
            await markGeminiLimitReached(uid, 'chat').catch(() => {})
          }
        }
      }

      return NextResponse.json({ error: 'No API key available' }, { status: 401 })
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
      // A full session transcript can be large (a 55-min session is ~60k chars).
      // Gemini handles that easily; cap generously rather than the old 50k that
      // rejected long sessions outright.
      if (!transcript || typeof transcript !== 'string' || transcript.length > 200000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }

      const systemPrompt = TRANSCRIPT_QA_SYSTEM_PROMPT.replace('{transcript}', transcript)
      const messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [
        { role: 'user', parts: [{ text: question }] },
      ]

      // Groq's free tier can't accept a long transcript in one request (~12k
      // token cap), so only use it when the transcript is small enough.
      const groqViable = Math.ceil((systemPrompt.length + question.length) / 4) <= 10000
      const userGeminiKey = req.headers.get('x-gemini-key')
      let geminiTransient = false

      // 1. User's own Gemini key — no per-day cap, handles long transcripts.
      if (userGeminiKey) {
        try {
          const { text: answer } = await chatResponse(messages, systemPrompt, userGeminiKey)
          if (answer.trim()) return NextResponse.json({ answer, provider: 'gemini' })
        } catch (err) {
          if (!(err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR)) geminiTransient = true
        }
      }

      // 2. Shared server key.
      if (process.env.GEMINI_API_KEY) {
        try {
          const { text: answer, totalTokens } = await chatResponse(messages, systemPrompt)
          if (answer.trim()) {
            if (uid && typeof uid === 'string') await updateGeminiUsage(uid, 'chat', totalTokens).catch(() => {})
            return NextResponse.json({ answer, provider: 'gemini' })
          }
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
            if (typeof uid === 'string') await markGeminiLimitReached(uid, 'chat').catch(() => {})
          } else {
            geminiTransient = true
          }
        }
      }

      // 3. Groq — only if the transcript is short enough for its free-tier limit.
      const groqKey = req.headers.get('x-groq-key')
      if (groqViable && groqKey) {
        try {
          const { content: answer } = await generateNoteGroq(question, systemPrompt, groqKey)
          if (answer.trim()) return NextResponse.json({ answer, provider: 'groq' })
        } catch { /* fall through to a clear error */ }
      }

      // Nothing worked. If Gemini only stumbled transiently (e.g. per-minute rate
      // limit right after a long recording), a retry recovers it.
      if (geminiTransient) {
        return NextResponse.json({ error: 'The AI is busy right now. Wait a moment and ask again.' }, { status: 429 })
      }
      return NextResponse.json({
        error: !groqViable
          ? 'This transcript is long, so answering needs Gemini. Add your Gemini API key in Settings → API Keys, or wait for your Gemini daily limit to reset.'
          : 'No AI key available. Add your Gemini or Groq key in Settings → API Keys.',
      }, { status: 401 })
    }

    // ── Prompt engineering: natural language → AI system prompt ────────────────
    if (type === 'engineer-prompt') {
      const { label, description, example, uid } = body as {
        label?: string
        description: string
        example?: string
        uid?: string
      }

      if (!description || typeof description !== 'string' || description.length > 2000) {
        return NextResponse.json({ error: 'Invalid description' }, { status: 400 })
      }

      const engineerSystemPrompt = `You are a clinical AI prompt engineer for LushNote, a note-writing tool for psychiatrists.
A doctor wants to add a custom section to their clinical notes. They have described what they want in plain language.
Your task: write a concise, specific system prompt that will guide an AI to write that section professionally.

Rules for the prompt you write:
- Begin with "You are a clinical documentation assistant writing the [section name] section of a psychiatric progress note."
- Specify exactly what clinical content to include from the raw notes
- Instruct the AI to use professional third-person clinical language
- Instruct the AI to output only the section text, no labels or headings
- If an example output was provided, mirror that format and level of detail
- Be under 150 words total

Return ONLY the system prompt text, nothing else - no explanation, no preamble.`

      const userMsg = [
        `Section name: "${label || 'Custom Section'}"`,
        `Doctor's description: ${description}`,
        example ? `Example of desired output:\n${example}` : '',
      ].filter(Boolean).join('\n\n')

      const msgs: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> = [
        { role: 'user', parts: [{ text: userMsg }] },
      ]

      if (process.env.GEMINI_API_KEY) {
        try {
          const { text: systemPrompt, totalTokens } = await chatResponse(msgs, engineerSystemPrompt)
          if (uid && typeof uid === 'string') {
            await updateGeminiUsage(uid, 'chat', totalTokens).catch(() => {})
          }
          return NextResponse.json({ systemPrompt, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_RATE_LIMIT_ERROR && typeof uid === 'string') {
            await markGeminiLimitReached(uid, 'chat').catch(() => {})
          }
        }
      }

      const groqKey = req.headers.get('x-groq-key')
      if (!groqKey) {
        return NextResponse.json({ error: 'No API key available' }, { status: 401 })
      }
      const { content: systemPrompt } = await generateNoteGroq(userMsg, engineerSystemPrompt, groqKey)
      return NextResponse.json({ systemPrompt, provider: 'groq' })
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
          await updateGeminiUsage(uid, 'chat', totalTokens).catch(() => {})
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
