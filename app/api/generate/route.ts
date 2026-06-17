import { NextRequest, NextResponse } from 'next/server'
import { generateNote, checkQuota } from '@/lib/gemini'
import { generateNoteGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage } from '@/lib/firestore/profiles'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      uid?: string
      transcript?: string
      templatePrompt?: string
      systemPrompt?: string
      mode?: string
      letterType?: string
    }

    const { uid, transcript, templatePrompt, systemPrompt, mode, letterType } = body

    // Letter AI generation — separate path, no uid/quota tracking
    if (mode === 'letter' && letterType && transcript) {
      if (typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 100000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }

      const letterPrompts: Record<string, string> = {
        referral: `You are a medical assistant. Extract structured information from this clinical dictation to populate a referral letter.
Return ONLY valid JSON matching this schema (empty string for anything not mentioned):
{
  "doctorName": "",
  "admissionUnit": "",
  "presentingComplaint": "",
  "secondParagraph": "",
  "referralReason": ""
}
Do not fabricate clinical information.
Dictation: ${transcript}`,

        records: `Extract information from this dictation for a medical records request letter.
Return ONLY valid JSON:
{
  "recordsLocation": "",
  "secondParagraphRecords": ""
}
Dictation: ${transcript}`,

        freetext: `You are a medical professional's writing assistant.
Based on this dictation, write a professional medical letter body in plain text.
Do NOT include salutation, subject line, closing, or signature — only the main paragraphs.
Use the exact words and intent from the dictation.
Return ONLY the letter body as plain text.
Dictation: ${transcript}`,
      }

      const letterPrompt = letterPrompts[letterType]
      if (!letterPrompt) return NextResponse.json({ error: 'Unknown letterType' }, { status: 400 })

      const groqKey = req.headers.get('x-groq-key')

      if (process.env.GEMINI_API_KEY) {
        try {
          const { text: content } = await generateNote(letterPrompt, '')
          if (letterType === 'freetext') {
            return NextResponse.json({ letterFields: { freeTextContent: content.trim() } })
          }
          const jsonMatch = content.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const letterFields = JSON.parse(jsonMatch[0]) as Record<string, unknown>
            return NextResponse.json({ letterFields })
          }
        } catch { /* fall through to Groq */ }
      }

      if (!groqKey) {
        return NextResponse.json({ error: 'No API key available for generation' }, { status: 401 })
      }

      try {
        const { content } = await generateNoteGroq(letterPrompt, '', groqKey)
        if (letterType === 'freetext') {
          return NextResponse.json({ letterFields: { freeTextContent: content.trim() } })
        }
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const letterFields = JSON.parse(jsonMatch[0]) as Record<string, unknown>
          return NextResponse.json({ letterFields })
        }
        return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('429:')) {
          const waitSeconds = parseGroqWaitSeconds(err.message)
          return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
        }
        const msg = err instanceof Error ? err.message : 'Letter generation failed'
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    }

    // Standard note generation
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

    const profile = await getProfile(uid).catch(() => null)
    const prompt = `${templatePrompt}\n\n${transcript}`

    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const { text: content, totalTokens } = await generateNote(prompt, systemPrompt!)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
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
      const { content, totalTokens } = await generateNoteGroq(prompt, systemPrompt!, groqKey)
      return NextResponse.json({ content, provider: 'groq', groqTokensUsed: totalTokens })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('429:')) {
        const waitSeconds = parseGroqWaitSeconds(err.message)
        return NextResponse.json({ error: 'rate_limit', waitSeconds }, { status: 429 })
      }
      const msg = err instanceof Error ? err.message : 'Generation failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

  } catch {
    console.error('Generation error')
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
