import { NextRequest, NextResponse } from 'next/server'
import { generateNote, checkQuota, GEMINI_DAILY_LIMIT_ERROR, GEMINI_KEY_INVALID_ERROR } from '@/lib/gemini'
import { generateNoteGroq, parseGroqWaitSeconds } from '@/lib/groq'
import { getProfile, updateGeminiUsage, markSharedGeminiExhausted, sharedGeminiAvailable } from '@/lib/firestore/profiles-admin'
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
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue }
      // A quote inside a value is only the END of that value if what follows
      // structurally closes it. Clinical text is full of quotes — «"word salad"»,
      // a height of 5'8" — and treating those as terminators is what produced
      // "Expected ':' after property name". Anything else is escaped and kept.
      let j = i + 1
      while (j < s.length && (s[j] === ' ' || s[j] === '\n' || s[j] === '\r' || s[j] === '\t')) j++
      const next = s[j]
      if (j >= s.length || next === ':' || next === ',' || next === '}' || next === ']') {
        inStr = false
        out += c
        continue
      }
      out += '\\"'
      continue
    }
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

// A problem-list line ("# hypokalaemia - resolved") or a numbered item
// ("3. IDC removal"). These are the lines a doctor notices immediately when they
// go missing, and the ones a summarising model drops first.
// Lettered sub-items count too: "a. Cease if no stroke" under an aspirin load is
// an instruction, not decoration.
const MUST_KEEP_LINE = /^\s*(?:[#•]|\d+[.)]|[a-z][.)])\s*\S/
// Same marker WITHOUT the trailing \S, so stripping it doesn't also swallow the
// first letter of the content ("# Delirium" → "elirium", which matches nothing).
const LINE_MARKER = /^\s*(?:[#•]|\d+[.)]|[a-z][.)])\s*/

function significantWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4)
}

// Every string in the reply, joined with real whitespace. NOT JSON.stringify:
// that renders a newline as the two characters \ and n, which then glue onto the
// following word ("active\nFunctional" → "nfunctional") and make it look missing.
function flattenStrings(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(flattenStrings).join(' ')
  if (v && typeof v === 'object') return Object.values(v).map(flattenStrings).join(' ')
  return ''
}

// What fraction of the source's problem-list and numbered lines survived into
// the model's reply. Prompts alone did not hold this — the same ward note came
// back complete on one run and with its whole problem list missing on the next,
// depending on which provider answered — so the result is measured rather than
// assumed.
function sourceCoverage(source: string, reply: string): number {
  const lines = source.split('\n').filter(l => MUST_KEEP_LINE.test(l))
  if (lines.length === 0) return 1
  const haystack = new Set(significantWords(reply))
  let covered = 0
  for (const line of lines) {
    const words = significantWords(line.replace(LINE_MARKER, ''))
    if (words.length === 0) { covered++; continue }
    const hits = words.filter(w => haystack.has(w)).length
    if (hits / words.length >= 0.6) covered++
  }
  return covered / lines.length
}

// Below this, treat the reply as having dropped content and pay for a better one.
const COVERAGE_FLOOR = 0.9

// Source lines the reply does not account for anywhere. Same word-overlap test
// as sourceCoverage, but over every substantive line rather than just the
// problem list — a rewording still counts as covered, a dropped line does not.
function unrepresentedLines(source: string, reply: string): string[] {
  const haystack = new Set(significantWords(reply))
  const out: string[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // One significant word is still judgeable and often the whole point of the
    // line — "- For benzotropine" is a drug instruction, not a fragment.
    const words = significantWords(line.replace(LINE_MARKER, ''))
    if (words.length === 0) continue
    const hits = words.filter(w => haystack.has(w)).length
    if (hits / words.length < 0.6) out.push(line)
  }
  return out
}

// The doctor's rule: if a topic isn't covered by a column it goes under "Other
// topics", and nothing is lost. This enforces it in code rather than trusting
// the model to have followed the instruction — whatever it left behind is
// appended verbatim as one more extras block.
function appendUnfiled(source: string, fields: Record<string, unknown>): Record<string, unknown> {
  const leftover = unrepresentedLines(source, flattenStrings(fields))
  if (!leftover.length) return fields
  const extras = Array.isArray(fields.extras) ? [...fields.extras] : []
  extras.push({ label: 'Also on the note', content: leftover.join('\n').slice(0, 4000) })
  return { ...fields, extras }
}

// Shown when every provider is exhausted. Plain language, and it tells the
// doctor what they can actually do about it.
const AI_LIMIT_MESSAGE = 'Dear doctor — our free AI usage limit has been reached for now. Please try again later today, or tomorrow. To keep working straight away, add your own Gemini or Groq API key in Settings → API Keys.'
const AI_UNAVAILABLE = 'ai-unavailable'

// Why nothing could answer. A doctor using her OWN Gemini key was being told a
// free usage limit was reached and to add a key she already had — because the
// user-key attempt failed into a bare catch and the real reason was thrown away.
type AiFailure = 'exhausted' | 'no-key' | 'user-key-invalid' | 'user-key-quota'

class AiUnavailable extends Error {
  constructor(readonly reason: AiFailure) { super(AI_UNAVAILABLE) }
}

function aiFailureMessage(err: unknown): string {
  const reason = err instanceof AiUnavailable ? err.reason : 'exhausted'
  if (reason === 'user-key-invalid') {
    return 'Google rejected your Gemini API key. Open Settings → API Keys and paste it again, or create a new key at aistudio.google.com.'
  }
  if (reason === 'no-key') {
    return 'No API key reached the server. Open Settings → API Keys, paste your Gemini key and press Save key, then try again.'
  }
  if (reason === 'user-key-quota') {
    return 'Your own Gemini API key has hit its daily limit with Google. It resets at midnight US Pacific time. Adding a Groq key in Settings → API Keys keeps you working until then.'
  }
  return AI_LIMIT_MESSAGE
}

// A 70B model dilutes a long, nuanced system prompt — it followed the tone and
// dropped the content, filing a ward note's whole problem list nowhere. This
// goes LAST, where a short numbered block of hard rules survives best, and only
// on the Groq attempt.
const GROQ_HARD_RULES = `
STOP. BEFORE YOU ANSWER, CHECK THESE. YOUR OUTPUT IS COMPARED AGAINST THE SOURCE.
1. Every line starting with "#" MUST appear in your JSON. Copy all of them, including ones marked resolved.
2. Every numbered line (1. 2. 3. …) MUST appear in your JSON. Four in, four out.
3. Do not summarise. Do not merge two lines into one. Do not drop a line for being repetitive.
4. Any line that fits no named field goes in "extras". Never discard it.
5. Do not expand an abbreviation you are unsure of. Copy it as written.`

// Structured extraction is a fixed-answer job — at the default temperature of
// 1.0 the same note produced a different set of fields on every run.
const EXTRACTION_TEMPERATURE = 0.1

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
  // Hospital forms go onto the patient's physical chart, so fidelity beats
  // saving quota: Groq paraphrased the same note into half its content on one
  // run and kept it on the next, purely by which provider had capacity. Gemini
  // leads for those, with Groq still there when Gemini is exhausted.
  preferGemini?: boolean
  // Skip Groq entirely — used to re-run a job whose Groq answer was measurably
  // incomplete, where trying Groq again would just repeat the same loss.
  geminiOnly?: boolean
}): Promise<{ content: string; provider: 'groq' | 'gemini' }> {
  const { prompt, system, req, uid, preferGemini, geminiOnly } = opts
  const groqKey = geminiOnly ? null : req.headers.get('x-groq-key')
  const userGeminiKey = req.headers.get('x-gemini-key')

  if (groqKey && !preferGemini) {
    try {
      const { content } = await generateNoteGroq(prompt, system + GROQ_HARD_RULES, groqKey, undefined, EXTRACTION_TEMPERATURE)
      return { content, provider: 'groq' }
    } catch { /* rate-limited or failed — try Gemini below */ }
  }

  // The doctor's own Gemini key first: it's their quota, so never gate it. Keep
  // WHY it failed — if nothing else answers either, that reason is the only
  // thing that tells her what to actually do about it.
  let userKeyFailure: AiFailure | null = null
  if (userGeminiKey) {
    try {
      const { text, totalTokens } = await generateNote(prompt, system, userGeminiKey, { temperature: EXTRACTION_TEMPERATURE })
      if (uid) await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
      return { content: text, provider: 'gemini' }
    } catch (err) {
      const m = err instanceof Error ? err.message : ''
      userKeyFailure = m === GEMINI_KEY_INVALID_ERROR ? 'user-key-invalid'
        : m === GEMINI_DAILY_LIMIT_ERROR ? 'user-key-quota'
        : null
      if (userKeyFailure) {
        logToSink({ level: 'warn', tag: 'generate', message: `user gemini key: ${userKeyFailure}`, route: '/api/generate', uid })
      }
    }
  }

  if (process.env.GEMINI_API_KEY && await sharedGeminiAvailable()) {
    const profile = uid ? await getProfile(uid).catch(() => null) : null
    if (!uid || checkQuota(profile?.geminiUsage ?? {}, 'gemini-2.5-flash')) {
      try {
        const { text, totalTokens } = await generateNote(prompt, system, undefined, { temperature: EXTRACTION_TEMPERATURE })
        if (uid) await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
        return { content: text, provider: 'gemini' }
      } catch (err) {
        if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
          await markSharedGeminiExhausted().catch(() => {})
        }
      }
    }
  }

  // Gemini-first jobs still fall back to Groq rather than failing outright.
  if (groqKey && preferGemini) {
    try {
      const { content } = await generateNoteGroq(prompt, system + GROQ_HARD_RULES, groqKey, undefined, EXTRACTION_TEMPERATURE)
      return { content, provider: 'groq' }
    } catch { /* exhausted everywhere */ }
  }

  // Nothing was even attempted: no key of any kind arrived with the request.
  const noKeyAtAll = !groqKey && !userGeminiKey && !process.env.GEMINI_API_KEY
  throw new AiUnavailable(userKeyFailure ?? (noKeyAtAll ? 'no-key' : 'exhausted'))
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

NOTHING MAY BE LOST — this note goes onto the patient's chart:
- Every clinical item in the source must appear in the note. Never drop an item because it looks minor, resolved, repetitive or already covered.
- A problem list — lines beginning "#", or a "Current Issues" / "Issues" / "Problems" section — is reproduced IN FULL as its own section, one problem per line, in the order given, INCLUDING problems marked resolved or inactive, with that status word kept. Deciding a problem no longer belongs on the list is the treating doctor's call, not yours.
- Keep the source's own section headings (Current Issues, Progress, Obs, Plan …). Only fall back to standard headings for content that arrived without one.
- Keep clinical abbreviations exactly as written: IDC, TOU, NH, PT, OT, r/v, o/t, b/g, LL, obs. Do NOT expand an abbreviation into a guessed full form — writing "Intermittent Withdrawal Catheter" for IDC invents a device that does not exist.
- Reproduce every numbered plan item. Four plan items in, four plan items out.
- Before you answer, re-read the source and check each item appears in noteText.

STYLE & FORMATTING:
- Tidy the wording into professional clinical prose — fix grammar and half-finished phrasing — but never at the cost of content. Preserve all clinical facts, names, and figures exactly.
- Organise the note under clinical subtopic headings. Put each heading on its own line and bold it with double asterisks, e.g. "**History of Presenting Complaint**". Recognise common subtopics INCLUDING BUT NOT LIMITED TO: Current Issues, History of Presenting Complaint, Progress, Past Medical History, Current Medications, Family History, Social History, Allergies, Vitals, Observations, Physical Examination, Investigations, Assessment / Impression, Plan (also keep any SOAP headings or other subtopics the doctor actually spoke). A heading is a short label on its own line — a line that is entirely bold renders bold AND underlined.
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
        const { content } = await runExtraction({ prompt: formPrompt, system: systemInstruction, req, uid, preferGemini: true })
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          // Parse in isolation: a malformed reply is the AI's problem, not
          // something to show the doctor as a raw syntax error.
          let formFields: Record<string, unknown> | null = null
          try {
            formFields = JSON.parse(repairJsonControlChars(jsonMatch[0])) as Record<string, unknown>
          } catch {
            logToSink({ level: 'warn', tag: 'generate', message: `${mode} reply was not valid JSON`, route: '/api/generate', uid })
          }
          if (formFields) return NextResponse.json({ formFields })
        }
        return NextResponse.json({ error: 'The AI reply came back garbled. Please try again — it usually works on a second attempt.' }, { status: 502 })
      } catch (err) {
        if (err instanceof Error && err.message === AI_UNAVAILABLE) {
          return NextResponse.json({ error: aiFailureMessage(err) }, { status: 429 })
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
- Keep one item per line where the source is a list. Do not add commentary or a summary.
- Keep indentation. A sub-item written under a parent ("5. Aspirin 300mg load" / "  a. Cease if no stroke") keeps its two-space indent and stays directly beneath that parent. Never promote a sub-item to top level and never fold it into its parent's line.

NOTHING MAY BE LOST — the most important rule:
- Every line of the note must end up in exactly ONE output field. Not zero. Not two.
- "extras" is the safety net. Anything that does not belong under a named field goes there rather than being dropped.
- The problem list is NOT filtered by status. Put EVERY "#" line in currentIssues, including problems marked resolved, inactive, old or crossed off, and keep the status word with the problem ("# hypokalaemia - resolved"). Deciding a problem is no longer current is the doctor's call, not yours.
- A ward-round header (unit, team, consultant names) and the entry's date/time are content, not decoration — put them in extras.
- Never place the same sentence in two fields. Choose the single best home for it.
- Do not summarise, shorten, merge or reorder lines. Copy the doctor's wording.
- Before you answer, re-read the note line by line and check that each line appears somewhere in your JSON. Anything you cannot account for goes into extras.`
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
- currentIssues: The note's problem list — EVERY "#" heading, one per line, in the order written. Include problems marked resolved/inactive and keep that status word with them. Include a brief qualifier from that section only if it identifies the problem. Else ""
- managementIP: What was DONE or DECIDED in hospital for those problems (treatments started/changed, decisions such as "not for CEA", referrals made), one per line, else "". Subjective progress and how the patient feels are NOT management — those go to extras under the note's own heading (e.g. "Progress").
- pastMedicalHistory: The "PHx:" content — past medical, psychiatric and surgical history only, else ""
- socialHistory: The "SHx:" content — living situation, supports, occupation, smoking, alcohol, driving, else ""
- medications: Medications with doses and any changes, one per line (e.g. "escitalopram increased to 15mg daily"), else ""
- bloodsPathology: Blood results and pathology, else ""
- imaging: Imaging and imaging-like investigations with their findings, one per line, keeping the modality label (CT, MRI, carotid U/S, TTE …), else ""
- plan: The forward plan, one item per line, else ""
- extras: EVERYTHING ELSE the note contains that no field above captures — for example Progress, Impression, Examination, Observations, Investigations, Issues, Allergies, Vitals, Family history, the ward-round header, the entry date/time. Return an array of {"label": "<the note's own heading if it has one, else a short plain label>", "content": "<that content, copied>"}. Use [] only when genuinely nothing is left over. Never repeat content already placed in a field above.

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "dob": "",
  "bedNumber": "",
  "presentingIssue": "",
  "currentIssues": "",
  "managementIP": "",
  "pastMedicalHistory": "",
  "socialHistory": "",
  "medications": "",
  "bloodsPathology": "",
  "imaging": "",
  "plan": "",
  "extras": []
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
- socialHistory: Social history — living situation, supports, occupation, smoking, alcohol, driving, else ""
- medications: Current medications with doses, one per line as "Name Dose Frequency" (preserve doses EXACTLY), else ""
- bloodsPathology: Relevant blood results and pathology, else ""
- imaging: Relevant imaging findings, else ""
- plan: Ongoing plan and next steps (one per line if several), else ""
- extras: EVERYTHING ELSE the note contains that no field above captures — for example Progress, Impression, Examination, Observations, Investigations, Issues, Allergies, Vitals, Family history, the ward-round header, the entry date/time. Return an array of {"label": "<the note's own heading if it has one, else a short plain label>", "content": "<that content, copied>"}. Use [] only when genuinely nothing is left over. Never repeat content already placed in a field above.

Return ONLY valid JSON — no markdown, no explanation, no extra text:
{
  "dob": "",
  "bedNumber": "",
  "presentingIssue": "",
  "currentIssues": "",
  "managementIP": "",
  "pastMedicalHistory": "",
  "socialHistory": "",
  "medications": "",
  "bloodsPathology": "",
  "imaging": "",
  "plan": "",
  "extras": []
}

DICTATION:
${transcript}`

      try {
        const first = await runExtraction({ prompt: intakePrompt, system: systemInstruction, req, uid })
        // Parse in isolation: a malformed reply is the AI's problem, not
        // something to show the doctor as a raw syntax error.
        const parse = (content: string): Record<string, unknown> | null => {
          const m = content.match(/\{[\s\S]*\}/)
          if (!m) return null
          try {
            return JSON.parse(repairJsonControlChars(m[0])) as Record<string, unknown>
          } catch {
            logToSink({ level: 'warn', tag: 'generate', message: `${mode} reply was not valid JSON`, route: '/api/generate', uid })
            return null
          }
        }

        let patientFields = parse(first.content)
        // This record is what a hospital form is later built from, so a dropped
        // problem list follows the patient onto their chart. When Groq's answer
        // measurably loses lines, spend one Gemini call rather than keep it.
        if (patientFields && first.provider === 'groq') {
          const before = sourceCoverage(transcript, flattenStrings(patientFields))
          if (before < COVERAGE_FLOOR) {
            logToSink({ level: 'warn', tag: 'generate', message: `${mode} groq coverage ${Math.round(before * 100)}% — retrying on gemini`, route: '/api/generate', uid })
            try {
              const second = await runExtraction({ prompt: intakePrompt, system: systemInstruction, req, uid, geminiOnly: true })
              const retried = parse(second.content)
              if (retried && sourceCoverage(transcript, flattenStrings(retried)) > before) patientFields = retried
            } catch { /* keep the first answer rather than failing outright */ }
          }
        }

        if (patientFields) return NextResponse.json({ patientFields: appendUnfiled(transcript, patientFields) })
        return NextResponse.json({ error: 'The AI reply came back garbled. Please try again — it usually works on a second attempt.' }, { status: 502 })
      } catch (err) {
        if (err instanceof Error && err.message === AI_UNAVAILABLE) {
          return NextResponse.json({ error: aiFailureMessage(err) }, { status: 429 })
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
          // Parse in isolation: a malformed reply is the AI's problem, not
          // something to show the doctor as a raw syntax error.
          let letterFields: Record<string, unknown> | null = null
          try {
            letterFields = JSON.parse(repairJsonControlChars(jsonMatch[0])) as Record<string, unknown>
          } catch {
            logToSink({ level: 'warn', tag: 'generate', message: `${mode} reply was not valid JSON`, route: '/api/generate', uid })
          }
          if (letterFields) return NextResponse.json({ letterFields })
        }
        return NextResponse.json({ error: 'The AI reply came back garbled. Please try again — it usually works on a second attempt.' }, { status: 502 })
      } catch (err) {
        if (err instanceof Error && err.message === AI_UNAVAILABLE) {
          return NextResponse.json({ error: aiFailureMessage(err) }, { status: 429 })
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
        const m = err instanceof Error ? err.message : ''
        // A rejected key is not a rate limit and never recovers on a retry —
        // say so instead of quietly falling through to a quota message.
        if (m === GEMINI_KEY_INVALID_ERROR) {
          logToSink({ level: 'warn', tag: 'generate', message: 'user gemini key rejected', route: '/api/generate', uid })
          return NextResponse.json({
            error: 'Google rejected your Gemini API key. Open Settings → API Keys and paste it again, or create a new key at aistudio.google.com.',
          }, { status: 401 })
        }
        if (m === GEMINI_DAILY_LIMIT_ERROR) geminiDaily = true
        else geminiTransient = true
      }
    }

    // 2. Shared server key, gated by the per-user 20/day counter.
    if (process.env.GEMINI_API_KEY && await sharedGeminiAvailable()) {
      const quota = profile?.geminiUsage ?? {}
      if (checkQuota(quota, 'gemini-2.5-flash')) {
        try {
          const { text: content, totalTokens } = await generateNote(prompt, effectiveSystemPrompt)
          await updateGeminiUsage(uid, 'gemini-2.5-flash', totalTokens).catch(() => {})
          return NextResponse.json({ content, provider: 'gemini' })
        } catch (err) {
          if (err instanceof Error && err.message === GEMINI_DAILY_LIMIT_ERROR) {
            await markSharedGeminiExhausted().catch(() => {})
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
