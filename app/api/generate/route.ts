import { NextRequest, NextResponse } from 'next/server'
import { generateNote, checkQuota, GEMINI_DAILY_LIMIT_ERROR } from '@/lib/gemini'
import { generateNoteGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markGeminiLimitReached } from '@/lib/firestore/profiles-admin'
import { rateLimit } from '@/lib/rateLimit'
import { applyTranscriptRedactions, privacyDirective, DEFAULT_TRANSCRIPT_PRIVACY } from '@/lib/redact'
import { logToSink } from '@/lib/firestore/systemLogs'

// Generating a note from a long transcript can exceed Vercel's 10s Hobby
// default. 60s is the Hobby-plan ceiling.
export const maxDuration = 300

// LLMs frequently emit multi-line field values (e.g. a progress-note body or a
// medication list) with RAW newlines/tabs inside a JSON string — invalid JSON
// that makes JSON.parse throw "Bad control character in string literal". Escape
// control characters that appear INSIDE string literals (tracking string state so
// structural whitespace between tokens is left untouched) so the response parses.
function repairJsonControlChars(s: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (esc) { out += c; esc = false; continue }
    if (c === '\\') { out += c; esc = true; continue }
    if (c === '"') { inStr = !inStr; out += c; continue }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue }
      if (c === '\r') { out += '\\r'; continue }
      if (c === '\t') { out += '\\t'; continue }
      const code = c.charCodeAt(0)
      if (code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue }
    }
    out += c
  }
  return out
}

// Shown when every provider is exhausted. Plain language, and it tells the
// doctor what they can actually do about it.
const AI_LIMIT_MESSAGE = 'Dear doctor — our free AI usage limit has been reached for now. Please try again later today, or tomorrow. To keep working straight away, add your own Gemini or Groq API key in Settings → API Keys.'
const AI_UNAVAILABLE = 'ai-unavailable'

// Letters, patient intake and hospital forms are short, structured JSON jobs, so
// they run Groq FIRST — it is fast and doesn't touch the doctor's Gemini quota.
// Groq's free tier caps tokens-per-minute though, and a long ward note or letter
// can exhaust that in a handful of requests, so Gemini is the fallback rather
// than a dead end. (Session notes are deliberately the opposite: Gemini first,
// with Groq as the backup.)
async function runExtraction(opts: {
  prompt: string
  system: string
  req: NextRequest
  uid?: string
}): Promise<{ content: string; provider: 'groq' | 'gemini' }> {
  const { prompt, system, req, uid } = opts
  const groqKey = req.headers.get('x-groq-key')
  const userGeminiKey = req.headers.get('x-gemini-key')

  if (groqKey) {
    try {
      const { content } = await generateNoteGroq(prompt, system, groqKey)
      return { content, provider: 'groq' }
    } catch { /* rate-limited or failed — try Gemini below */ }
  }

  // The doctor's own Gemini key first: it's their quota, so never gate it.
  if (userGeminiKey) {
    try {
      const { text, totalTokens } = await generateNote(prompt, system, userGeminiKey)
      if (uid) await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
      return { content: text, provider: 'gemini' }
    } catch { /* fall through to the shared key */ }
  }

  if (process.env.GEMINI_API_KEY) {
    const profile = uid ? await getProfile(uid).catch(() => null) : null
    if (!uid || checkQuota(profile?.geminiUsage ?? {}, 'gemini-2.5-flash')) {
      try {
        const { text, totalTokens } = await generateNote(prompt, system)
        if (uid) await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
        return { content: text, provider: 'gemini' }
      } catch (err) {
        if (uid && err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
          await markGeminiLimitReached(uid, 'gemini-2.5-flash').catch(() => {})
        }
      }
    }
  }

  throw new Error(AI_UNAVAILABLE)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      uid?: string
      transcript?: string
      templatePrompt?: string
      systemPrompt?: string
      mode?: string
      letterType?: string
      retry?: boolean
      customLetter?: {
        title?: string
        prompt?: string
        sections?: { key?: string; heading?: string; description?: string }[]
      }
      formName?: string
      source?: string
    }

    const { uid, transcript, templatePrompt, systemPrompt, mode, letterType, retry, customLetter, formName, source } = body

    // Hospital progress-note form — Groq-only extraction (same plumbing as
    // letters): pull patient identifiers + compose the note entry as prose.
    if (mode === 'hospital-form' && transcript) {
      if (typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 300000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }
      const systemInstruction = `You are an expert medical scribe transcribing a doctor's spoken dictation into a hospital progress note. Extract the patient identifiers and write the clinical entry. Never fabricate information; use "" for identifiers not mentioned.

DOSES & NUMBERS — CRITICAL FOR SAFETY:
- Write every dose EXACTLY as dictated. Convert spoken numbers to digits precisely ("one thousand" → 1000, "eighty one" → 81). Never round, drop, or add a digit. Append "mg" only to a bare number that is clearly a milligram strength.
- Do NOT correct, guess, or substitute drug names.

STYLE & FORMATTING:
- Write the note in formal, professional clinical prose. Do NOT reproduce the dictation word-for-word. Preserve all clinical facts, names, and figures exactly.
- Organise the note under clinical subtopic headings. Put each heading on its own line and bold it with double asterisks, e.g. "**History of Presenting Complaint**". Recognise common subtopics INCLUDING BUT NOT LIMITED TO: History of Presenting Complaint, Past Medical History, Current Medications, Family History, Social History, Allergies, Vitals, Physical Examination, Investigations, Assessment / Impression, Plan (also keep any SOAP headings or other subtopics the doctor actually spoke). A heading is a short label on its own line — a line that is entirely bold renders bold AND underlined.
- Use **bold** for key emphasis inside a sentence too. Use *italic* (single asterisks) sparingly.
- Use a numbered list (1. 2. 3., each item on its own line) where the content is naturally enumerated — a management plan, a medication list, a set of instructions or steps.
- Put each heading and each list item on its own line (a single newline). Separate distinct sections with a blank line. Never output markdown tables or other markup — only **bold**, *italic*, and numbered/bulleted lines. Only include a heading if the dictation actually covers it — never invent content to fill a section.`

      const formPrompt = `Extract information from this doctor's dictation for a hospital progress note${formName ? ` on the "${formName}" form` : ''}.

FIELD GUIDE:
- urNo: The patient's UR / medical record number if stated (digits), else ""
- surname: Patient surname, else ""
- givenNames: Patient given name(s), else ""
- dob: Patient date of birth DD/MM/YYYY, else "" (leave "" if only an age is given)
- sex: Exactly "Male", "Female", or "" — never any other value
- noteText: The full progress-note entry, formatted per the STYLE & FORMATTING rules — **bold** subtopic headings on their own lines, numbered lists where appropriate, a blank line between sections. Do NOT include the patient's name/UR/DOB line (those go in the identifier fields), and do NOT include a date/time line.

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "urNo": "",
  "surname": "",
  "givenNames": "",
  "dob": "",
  "sex": "",
  "noteText": ""
}

DICTATION:
${transcript}`

      try {
        const { content } = await runExtraction({ prompt: formPrompt, system: systemInstruction, req, uid })
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const formFields = JSON.parse(repairJsonControlChars(jsonMatch[0])) as Record<string, unknown>
          return NextResponse.json({ formFields })
        }
        return NextResponse.json({ error: 'The AI reply could not be read. Please try again.' }, { status: 500 })
      } catch (err) {
        if (err instanceof Error && err.message === AI_UNAVAILABLE) {
          return NextResponse.json({ error: AI_LIMIT_MESSAGE }, { status: 429 })
        }
        const msg = err instanceof Error ? err.message : 'Generation failed. Please try again.'
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    }

    // Patient intake — Groq-only extraction (same plumbing as letters/forms):
    // a doctor dictates a "reading note" for a new tracked patient and we pull
    // the structured clinical fields. No uid/quota tracking; no note is stored
    // here — the caller saves the result onto the patient profile.
    if (mode === 'patient-intake' && transcript) {
      if (typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 300000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }
      // Pasted EMR/ward notes (e.g. BOSSnet) are terse clinical shorthand with
      // their own conventions, so they need different handling from speech:
      // preserve the abbreviations rather than rewriting them into prose, and
      // understand the "#" problem-list / "PHx:" / "Plan" structure.
      const isPaste = source === 'paste'

      const systemInstruction = isPaste
        ? `You are an expert clinical information extractor. You are given a note copied verbatim from a hospital electronic medical record (e.g. BOSSnet ward notes / handover). Reorganise its content into structured fields. Never fabricate information — use "" for anything the note does not contain.

HOW THESE NOTES ARE WRITTEN — read carefully:
- They use terse medical shorthand and abbreviations: "83F" = 83-year-old female, "R)" / "L)" = right / left, "UL" / "LL" = upper / lower limb, "w" = with, "a/w" = associated with, "PHx:" = past history, "SHx:" = social history, "iADLs" = instrumental activities of daily living, "20PY" = 20 pack-years, "3/52" = 3 weeks, "30/7" = 30 days or a date.
- A line beginning with "#" is an ACTIVE PROBLEM heading. The indented "-" lines beneath it are the findings, investigations and management for that problem.
- A "Plan" section (often with "/" or "-" bullets) lists the forward plan.

EXTRACTION RULES:
- PRESERVE the doctor's original abbreviations, shorthand and wording. Do NOT expand them into long prose and do NOT "translate" them into plain English — clinicians rely on this shorthand.
- Content nested under a problem heading must still be routed to the correct field: imaging findings go to imaging, blood/pathology results go to bloodsPathology, medication changes go to medications, and what was done/decided goes to managementIP. Keep the problem heading itself in currentIssues.
- Copy every number, dose, date and percentage EXACTLY as written. Never round, drop or add a digit, and never substitute a drug name.
- Keep one item per line where the source is a list. Do not add commentary or a summary.`
        : `You are an expert medical scribe transcribing a doctor's spoken "reading note" about an inpatient into structured fields. Extract each field accurately from the dictation. The doctor may speak in any order and use informal language. Never fabricate information — use "" for anything not mentioned.

DOSES & NUMBERS — CRITICAL FOR SAFETY:
- Write every dose EXACTLY as dictated. Convert spoken numbers to digits precisely ("one thousand" → 1000, "eighty one" → 81). Never round, drop, or add a digit. Append "mg" only to a bare number that is clearly a milligram strength.
- Do NOT correct, guess, or substitute drug names.

STYLE:
- Rewrite each field into concise, professional clinical prose (not word-for-word dictation). Preserve all clinical facts, names, and figures exactly.
- Where a field is naturally a list (medications, current issues, plan), put one item per line.`

      const intakePrompt = isPaste
        ? `Extract information from this hospital record note into the fields below.

FIELD GUIDE:
- dob: Patient date of birth DD/MM/YYYY, else "" (leave "" if only an age like "83F" is given — do NOT calculate one)
- bedNumber: Ward and/or bed number if stated, else ""
- presentingIssue: The presentation / reason for admission — typically the opening summary line (e.g. demographics + presenting symptoms). Keep it as written, else ""
- currentIssues: The active problems, one per line — normally each "#" heading. Include a brief qualifier from that section only if it identifies the problem. Else ""
- managementIP: What has been done or decided in hospital for those problems (treatments started/changed, decisions such as "not for CEA", referrals made), one per line, else ""
- pastMedicalHistory: The "PHx:" content, plus "SHx:" / social history if present (label it), else ""
- medications: Medications with doses and any changes, one per line (e.g. "escitalopram increased to 15mg daily"), else ""
- bloodsPathology: Blood results and pathology, else ""
- imaging: Imaging and imaging-like investigations with their findings, one per line, keeping the modality label (CT, MRI, carotid U/S, TTE …), else ""
- plan: The forward plan, one item per line, else ""

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "dob": "",
  "bedNumber": "",
  "presentingIssue": "",
  "currentIssues": "",
  "managementIP": "",
  "pastMedicalHistory": "",
  "medications": "",
  "bloodsPathology": "",
  "imaging": "",
  "plan": ""
}

HOSPITAL RECORD NOTE:
${transcript}`
        : `Extract information from this doctor's dictation about a patient into the fields below.

FIELD GUIDE:
- dob: Patient date of birth DD/MM/YYYY, else "" (leave "" if only an age is given)
- bedNumber: Ward and/or bed number if stated, else ""
- presentingIssue: The reason for presentation / admission, else ""
- currentIssues: The active problems being managed now (one per line if several), else ""
- managementIP: Inpatient management to date, else ""
- pastMedicalHistory: Relevant past medical, psychiatric, or surgical history, else ""
- medications: Current medications with doses, one per line as "Name Dose Frequency" (preserve doses EXACTLY), else ""
- bloodsPathology: Relevant blood results and pathology, else ""
- imaging: Relevant imaging findings, else ""
- plan: Ongoing plan and next steps (one per line if several), else ""

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "dob": "",
  "bedNumber": "",
  "presentingIssue": "",
  "currentIssues": "",
  "managementIP": "",
  "pastMedicalHistory": "",
  "medications": "",
  "bloodsPathology": "",
  "imaging": "",
  "plan": ""
}

DICTATION:
${transcript}`

      try {
        const { content } = await runExtraction({ prompt: intakePrompt, system: systemInstruction, req, uid })
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const patientFields = JSON.parse(repairJsonControlChars(jsonMatch[0])) as Record<string, unknown>
          return NextResponse.json({ patientFields })
        }
        return NextResponse.json({ error: 'The AI reply could not be read. Please try again.' }, { status: 500 })
      } catch (err) {
        if (err instanceof Error && err.message === AI_UNAVAILABLE) {
          return NextResponse.json({ error: AI_LIMIT_MESSAGE }, { status: 429 })
        }
        const msg = err instanceof Error ? err.message : 'Generation failed. Please try again.'
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    }

    // Letter AI generation — Groq-only, transient, no uid/quota tracking
    if (mode === 'letter' && letterType && transcript) {
      if (typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 300000) {
        return NextResponse.json({ error: 'Invalid transcript' }, { status: 400 })
      }

      const systemInstruction = `You are an expert medical scribe. Extract clinical information from a doctor's verbal dictation and map it accurately to letter fields. The doctor may speak in any order and use informal language — identify all entities and assign them to the correct field. Never fabricate information. Use empty string "" for anything not mentioned.

DOSES & NUMBERS — CRITICAL FOR SAFETY:
- Write every dose EXACTLY as dictated. Convert spoken numbers to digits precisely: "one thousand" → 1000, "eighty one" → 81, "twenty" → 20. Never round, approximate, drop, or add a digit ("one thousand milligrams" is 1000 mg, NEVER 100 mg).
- If a medication dose number is given with no unit but is clearly a strength, append "mg" (e.g. "aspirin eighty one" → "Aspirin 81 mg"). Do not invent units for numbers that are not doses.
- Do NOT correct, guess, or substitute drug names — transcribe each medication name as given, even if it looks unusual.

STYLE:
- Rewrite content into formal, professional medical-letter prose. Do NOT reproduce the dictation word-for-word or keep conversational phrasing (e.g. "last 48 hours pain is completely resolved" → "Over the past 48 hours, the chest pain has fully resolved").`

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
- admissionUnit: Ward, unit, or service being referred to (e.g. "inpatient psychiatry", "acute mental health unit")
- admissionDateStart: Proposed admission or start date — DD/MM/YYYY
- admissionDateEnd: Proposed discharge or end date — DD/MM/YYYY
- presentingComplaint: FRAGMENT ONLY — the symptoms/complaint that follows "who presented with ___". Start directly with the symptoms (e.g. "acute confusion, agitation, and auditory hallucinations"). Do NOT start with the patient's name or "presented with". Do NOT write a full sentence.
- referralReason: What the patient is being referred for and why — 1–2 complete sentences of plain prose. Do NOT include a salutation, greeting, or "I am writing to..." intro. E.g. "James is referred for ongoing psychiatric review and medication optimisation for his schizoaffective disorder."
- secondParagraph: Additional clinical context — what happened during admission, current status, relevant background. 2–4 sentences of plain prose. CRITICAL: Do NOT include any salutation ("Dear...", "To Dr...", "I am writing"), subject line, or letter-style introduction. This text appears directly as a mid-letter paragraph.
- pastMedicalHistory: Relevant past medical, psychiatric, or surgical history if mentioned (plain text or one item per line)
- showPastMedicalHistory: true if any past history is mentioned; false otherwise
- medicationList: Current medications, one per line, as "Name Dose Frequency". Preserve each dose EXACTLY as dictated (see the DOSES rule — "one thousand milligrams" is 1000 mg, never 100 mg) and append "mg" to a bare dose number that is clearly a milligram strength (e.g. "Aspirin 81 mg daily", "Ticagrelor 90 mg twice daily").
- showMedicationList: true if any medications are mentioned; false otherwise
- dischargeSummaryAttached: true if the doctor says they are attaching or enclosing a discharge summary; false otherwise

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "recipientName": "",
  "recipientAddress": "",
  "patientName": "",
  "dob": "",
  "gender": "",
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

      let letterPrompt: string | undefined = letterPrompts[letterType]

      // Custom letter: the doctor's saved template drives the topics. The server
      // still owns the JSON contract so a quirky template can't break parsing.
      if (letterType === 'custom') {
        const secs = Array.isArray(customLetter?.sections)
          ? customLetter!.sections
              .filter(s => s && typeof s.key === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(s.key!))
              .slice(0, 12)
              .map(s => ({ key: s.key!, heading: String(s.heading ?? s.key), description: String(s.description ?? '').slice(0, 500) }))
          : []
        if (!secs.length) return NextResponse.json({ error: 'Invalid custom letter template' }, { status: 400 })
        const guidance = String(customLetter?.prompt ?? '').slice(0, 6000)
        const skeleton = `{
  "recipientName": "",
  "recipientAddress": "",
  "patientName": "",
  "dob": "",
  "sections": {
${secs.map(s => `    "${s.key}": ""`).join(',\n')}
  }
}`
        letterPrompt = `Extract information from this doctor's dictation to populate a "${customLetter?.title || 'letter'}".
${guidance ? `\nGUIDANCE:\n${guidance}\n` : ''}
FIELD GUIDE:
- recipientName: Full name/title of who this letter is addressed TO
- recipientAddress: Their address, hospital, or clinic
- patientName: Patient's full name if mentioned
- dob: Patient date of birth DD/MM/YYYY — leave "" if not mentioned
Sections (write formal letter prose for each, "" if not covered in the dictation):
${secs.map(s => `- ${s.key}: ${s.heading}${s.description ? ` — ${s.description}` : ''}`).join('\n')}

Return ONLY valid JSON — no markdown, no explanation, no extra text:
${skeleton}

DICTATION:
${transcript}`
      }

      if (!letterPrompt) return NextResponse.json({ error: 'Unknown letterType' }, { status: 400 })

      try {
        const { content } = await runExtraction({ prompt: letterPrompt, system: systemInstruction, req, uid })
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const letterFields = JSON.parse(repairJsonControlChars(jsonMatch[0])) as Record<string, unknown>
          return NextResponse.json({ letterFields })
        }
        return NextResponse.json({ error: 'The AI reply could not be read. Please try again.' }, { status: 500 })
      } catch (err) {
        if (err instanceof Error && err.message === AI_UNAVAILABLE) {
          return NextResponse.json({ error: AI_LIMIT_MESSAGE }, { status: 429 })
        }
        const msg = err instanceof Error ? err.message : 'Generation failed. Please try again.'
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    }

    // Standard note generation
    if (!uid || typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
      return NextResponse.json({ error: 'Invalid or missing uid' }, { status: 401 })
    }

    if (!transcript || typeof transcript !== 'string' || transcript.length === 0 || transcript.length > 300000) {
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
      logToSink({ level: 'warn', tag: 'generate', message: 'rate limit exceeded', route: '/api/generate', status: 429, uid })
      return NextResponse.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429 })
    }

    const profile = await getProfile(uid).catch(() => null)
    if (profile?.status === 'disabled') {
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 })
    }

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

    // Groq's free tier caps a single request at ~12k tokens/min (input + output),
    // so a long session can only be done by Gemini. Estimate the size so we never
    // dump an oversized transcript onto Groq (a guaranteed 413).
    const estimatedTokens = Math.ceil((effectiveSystemPrompt.length + prompt.length) / 4)
    const groqViable = estimatedTokens <= 10000

    // Track WHY Gemini failed. A transient failure (per-minute rate limit — common
    // right after a long recording, whose many transcription calls briefly exhaust
    // Gemini's RPM) recovers on a short retry. A daily-exhaustion does not.
    let geminiTransient = false
    let geminiDaily = false

    // 1. User's own Gemini key (primary) — their Google account governs quota.
    // Still count it against the per-user daily counter so the "X / 20" display
    // reflects real usage (their key hits the same free-tier RPD).
    if (userGeminiKey) {
      try {
        const { text: content, totalTokens } = await generateNote(prompt, effectiveSystemPrompt, userGeminiKey)
        await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
        return NextResponse.json({ content, provider: 'gemini' })
      } catch (err) {
        if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) geminiDaily = true
        else geminiTransient = true
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
            geminiDaily = true
          } else {
            geminiTransient = true
          }
        }
      } else {
        geminiDaily = true
      }
    }

    // Too long for Groq → Gemini is the only option. Google's 429 responses often
    // bundle several quota metrics together, so a per-minute stumble can look like
    // a per-day exhaustion (this is why the same transcript reliably works on a
    // retry a minute later). Rather than trust that classification on the first
    // failure, ask the client to silently retry once; only if the SAME failure
    // survives a fresh attempt (retry === true) do we give the actionable message.
    if (!groqViable) {
      if (geminiTransient || !retry) {
        return NextResponse.json({ error: 'rate_limit', waitSeconds: 60 }, { status: 429 })
      }
      return NextResponse.json({
        error: 'This session is too long for the free Groq fallback (~12,000-token limit) and your Gemini limit is used up for now. Add your own Gemini API key in Settings → API Keys, wait for your Gemini daily limit to reset, or use "Generate manually".',
      }, { status: 413 })
    }

    const groqKey = req.headers.get('x-groq-key')
    if (!groqKey) {
      // Short enough for Groq but no Groq key. If Gemini stumbled transiently, a
      // retry recovers it; otherwise there's simply no usable key.
      if (geminiTransient) {
        return NextResponse.json({ error: 'rate_limit', waitSeconds: 60 }, { status: 429 })
      }
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
      // A Gemini failure with a Groq 413 as backup → prefer a silent retry first,
      // same reasoning as the !groqViable branch above.
      if (err instanceof Error && err.message.startsWith('413:')) {
        if (geminiTransient || !retry) {
          return NextResponse.json({ error: 'rate_limit', waitSeconds: 60 }, { status: 429 })
        }
        return NextResponse.json({
          error: 'This session is too long for the free Groq fallback (~12,000-token limit) and your Gemini limit is used up for now. Add your own Gemini API key in Settings → API Keys, wait for your Gemini daily limit to reset, or use "Generate manually".',
        }, { status: 413 })
      }
      const msg = err instanceof Error ? err.message : 'Generation failed'
      return NextResponse.json({ error: msg }, { status: 500 })
    }

  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[generate] fatal: ${detail}`)
    logToSink({ level: 'error', tag: 'generate', message: detail, route: '/api/generate', status: 500 })
    return NextResponse.json({ error: `Generation failed: ${detail}` }, { status: 500 })
  }
}
