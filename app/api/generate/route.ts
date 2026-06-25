import { NextRequest, NextResponse } from 'next/server'
import { generateNote, checkQuota, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { generateNoteGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles'
import { rateLimit } from '@/lib/rateLimit'
import { applyTranscriptRedactions, privacyDirective, DEFAULT_TRANSCRIPT_PRIVACY } from '@/lib/redact'

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

    // Letter AI generation — Groq-only, transient, no uid/quota tracking
    if (mode === 'letter' && letterType && transcript) {
      if (typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 100000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }

      const systemInstruction = `You are an expert medical scribe. Extract clinical information from a doctor's verbal dictation and map it accurately to letter fields. The doctor may speak in any order and use informal language — identify all entities and assign them to the correct field. Never fabricate information. Use empty string "" for anything not mentioned.`

      const letterPrompts: Record<string, string> = {
        referral: `Extract ALL clinical information from this psychiatrist's dictation to populate a referral letter. Map entities to the correct field regardless of speaking order.

IMPORTANT — understand how these fields are assembled into the final letter:
The letter body is constructed as follows:
  1. "Thank you for seeing [Mr/Ms] [patientName]. [FirstName] is a [age] [gender] who presented with [presentingComplaint]."
  2. [secondParagraph] — rendered as its own paragraph
  3. [referralReason] — rendered as its own paragraph
  4. Optional: Past Medical History section
  5. Optional: Medication List section

FIELD GUIDE — read carefully before extracting:
- recipientName: Full name/title of the doctor or specialist this letter is being sent TO (e.g. "Dr Sarah Jones", "The Consultant Psychiatrist")
- recipientAddress: Address, hospital name, or clinic of the recipient
- patientName: Patient's full name (may be said as "my patient [name]" or just stated)
- dob: Patient date of birth — format DD/MM/YYYY. If only age is given, leave empty.
- gender: Exactly "male", "female", or "" — never any other value
- doctorName: Admitting doctor name if explicitly different from recipient; otherwise leave ""
- admissionUnit: Ward, unit, or service being referred to (e.g. "inpatient psychiatry", "acute mental health unit")
- admissionDateStart: Proposed admission or start date — DD/MM/YYYY
- admissionDateEnd: Proposed discharge or end date — DD/MM/YYYY
- presentingComplaint: FRAGMENT ONLY — the symptoms/complaint that follows "who presented with ___". Start directly with the symptoms (e.g. "acute confusion, agitation, and auditory hallucinations"). Do NOT start with the patient's name or "presented with". Do NOT write a full sentence.
- referralReason: What the patient is being referred for and why — 1–2 complete sentences of plain prose. Do NOT include a salutation, greeting, or "I am writing to..." intro. E.g. "James is referred for ongoing psychiatric review and medication optimisation for his schizoaffective disorder."
- secondParagraph: Additional clinical context — what happened during admission, current status, relevant background. 2–4 sentences of plain prose. CRITICAL: Do NOT include any salutation ("Dear...", "To Dr...", "I am writing"), subject line, or letter-style introduction. This text appears directly as a mid-letter paragraph.
- pastMedicalHistory: Relevant past medical, psychiatric, or surgical history if mentioned (plain text or one item per line)
- showPastMedicalHistory: true if any past history is mentioned; false otherwise
- medicationList: Current medications with doses and frequencies if mentioned (one per line)
- showMedicationList: true if any medications are mentioned; false otherwise
- dischargeSummaryAttached: true if the doctor says they are attaching or enclosing a discharge summary; false otherwise

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "recipientName": "",
  "recipientAddress": "",
  "patientName": "",
  "dob": "",
  "gender": "",
  "doctorName": "",
  "admissionUnit": "",
  "admissionDateStart": "",
  "admissionDateEnd": "",
  "presentingComplaint": "",
  "referralReason": "",
  "secondParagraph": "",
  "pastMedicalHistory": "",
  "showPastMedicalHistory": false,
  "medicationList": "",
  "showMedicationList": false,
  "dischargeSummaryAttached": false
}

DICTATION:
${transcript}`,

        records: `Extract all relevant information from this doctor's dictation to populate a medical records request letter.

FIELD GUIDE:
- recipientName: Name of the person, hospital, practice, or records department being written TO
- recipientAddress: Their address, hospital, or institution
- patientName: Patient's full name
- dob: Patient date of birth — DD/MM/YYYY. Leave "" if only age is mentioned.
- recordsLocation: Name of the hospital, practice, clinic, or provider that HOLDS the records being requested
- secondParagraphRecords: What specific records are needed, the time period covered, urgency, and purpose — 1–3 sentences of plain professional prose. Do NOT include a salutation, greeting, or "I am writing to..." intro.

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "recipientName": "",
  "recipientAddress": "",
  "patientName": "",
  "dob": "",
  "recordsLocation": "",
  "secondParagraphRecords": ""
}

DICTATION:
${transcript}`,

        freetext: `Extract recipient information and compose a professional letter body from this doctor's dictation.

FIELD GUIDE:
- recipientName: Full name/title of who this letter is addressed to
- recipientAddress: Their address, hospital, or institution
- patientName: Patient's full name if mentioned
- dob: Patient date of birth DD/MM/YYYY — leave "" if not mentioned
- freeTextContent: The complete letter body — main paragraphs ONLY. Do NOT include salutation ("Dear..."), subject line, closing ("Yours sincerely"), or signature — the letter template adds those automatically. Write in formal medical English capturing all clinical content from the dictation. Preserve all clinical facts, names, and figures exactly as stated.

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "recipientName": "",
  "recipientAddress": "",
  "patientName": "",
  "dob": "",
  "freeTextContent": ""
}

DICTATION:
${transcript}`,
      }

      const letterPrompt = letterPrompts[letterType]
      if (!letterPrompt) return NextResponse.json({ error: 'Unknown letterType' }, { status: 400 })

      const groqKey = req.headers.get('x-groq-key')
      if (!groqKey) {
        return NextResponse.json({ error: 'A Groq API key is required for letter generation. Add one in Settings > API Keys.' }, { status: 401 })
      }

      try {
        const { content } = await generateNoteGroq(letterPrompt, systemInstruction, groqKey)
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

    // Redact identifiable information before the transcript reaches any AI model.
    // Defaults to redact-all when the user has never configured privacy settings,
    // matching the Settings panel defaults. The raw transcript is stored client-
    // side for the clinician's reference; only the AI sees the redacted copy.
    const privacy = profile?.transcriptPrivacy ?? DEFAULT_TRANSCRIPT_PRIVACY
    const safeTranscript = applyTranscriptRedactions(transcript, privacy)
    const directive = privacyDirective(privacy)
    const effectiveSystemPrompt = directive
      ? `${systemPrompt ?? ''}\n\n${directive}`.trim()
      : (systemPrompt ?? '')

    const prompt = `${templatePrompt}\n\n${safeTranscript}`
    const userGeminiKey = req.headers.get('x-gemini-key')

    // 1. User's own Gemini key (primary) — their Google account governs quota.
    if (userGeminiKey) {
      try {
        const { text: content } = await generateNote(prompt, effectiveSystemPrompt, userGeminiKey)
        return NextResponse.json({ content, provider: 'gemini' })
      } catch {
        // fall through to shared key / Groq
      }
    }

    // 2. Shared server key, gated by the per-user 20/day counter.
    if (process.env.GEMINI_API_KEY) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const { text: content, totalTokens } = await generateNote(prompt, effectiveSystemPrompt)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
          return NextResponse.json({ content, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
            await markGeminiLimitReached(uid, 'gemini-2.5-flash').catch(() => {})
          }
          // transient 429 or other error → fall through to Groq without pegging
        }
      }
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      return NextResponse.json({ error: 'No API key available for generation' }, { status: 401 })
    }

    try {
      const { content, totalTokens } = await generateNoteGroq(prompt, effectiveSystemPrompt, groqKey)
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
