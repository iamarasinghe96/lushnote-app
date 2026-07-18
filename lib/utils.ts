import { WP_THEMES, type Note, type AnyTemplate, type ExtraSection, type LetterType, type LetterCommonFields, type ReferralFields, type RecordsFields, type FreetextFields, type LetterData, type HospitalFormData } from '@/types'

// The 11 core clinical note fields, in canonical order. Shared source of truth
// for rendering order fallbacks and for deciding whether a section key is core.
export const CORE_NOTE_FIELDS: (keyof Note)[] = [
  'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content',
  'scales', 'risk', 'referrals', 'summary', 'nextsteps',
]

export interface ParsedExtraSections {
  order: string[]          // full section key sequence in template order (core + extra keys)
  extras: ExtraSection[]   // the non-core sections, with their display labels + content
}

// Tolerant parse of Note.extraSections (a JSON string). Any malformed/missing
// value yields an empty result so renderers fall back to canonical order.
export function parseExtraSectionsField(raw?: string | null): ParsedExtraSections {
  if (!raw || typeof raw !== 'string') return { order: [], extras: [] }
  try {
    const obj = JSON.parse(raw) as Partial<ParsedExtraSections>
    const order = Array.isArray(obj.order) ? obj.order.filter(k => typeof k === 'string') : []
    const extras = Array.isArray(obj.extras)
      ? obj.extras
          .filter(e => e && typeof e.key === 'string')
          .map(e => ({ key: String(e.key), label: String(e.label ?? e.key), content: String(e.content ?? '') }))
      : []
    return { order, extras }
  } catch {
    return { order: [], extras: [] }
  }
}

// Serialize section order + extras for storage. Returns undefined when there is
// nothing template-specific to store (keeps old-shape notes and no-template
// notes free of the field). Capped at the Firestore rule limit.
export function serializeExtraSections(order: string[], extras: ExtraSection[]): string | undefined {
  const cleanExtras = extras
    .filter(e => e && e.key)
    .map(e => ({ key: e.key, label: e.label || e.key, content: e.content || '' }))
  if (order.length === 0 && cleanExtras.length === 0) return undefined
  const json = JSON.stringify({ order, extras: cleanExtras })
  return json.length > 30000 ? json.slice(0, 30000) : json
}

// Serialize a saved letter's structured fields for Note.letterData. Capped at the
// Firestore rule limit (40000). Returns undefined only for a missing payload.
export function serializeLetterData(data: LetterData): string | undefined {
  if (!data) return undefined
  const json = JSON.stringify(data)
  return json.length > 40000 ? json.slice(0, 40000) : json
}

// Tolerant parse of Note.letterData. Malformed/missing → null so callers can fall
// back to treating the doc as a plain note.
export function parseLetterData(raw?: string | null): LetterData | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const obj = JSON.parse(raw) as Partial<LetterData>
    if (!obj || typeof obj !== 'object' || !obj.common) return null
    return obj as LetterData
  } catch {
    return null
  }
}

// Serialize a filled hospital form for Note.formData (≤40000, the Firestore cap).
export function serializeHospitalFormData(data: HospitalFormData): string | undefined {
  if (!data) return undefined
  const json = JSON.stringify(data)
  return json.length > 40000 ? json.slice(0, 40000) : json
}

// Tolerant parse of Note.formData → null when missing/corrupt.
export function parseHospitalFormData(raw?: string | null): HospitalFormData | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const obj = JSON.parse(raw) as Partial<HospitalFormData>
    if (!obj || typeof obj !== 'object' || !obj.formKey || typeof obj.noteText !== 'string') return null
    return obj as HospitalFormData
  } catch {
    return null
  }
}

// Daily quota date aligned to Google's free-tier reset (US Pacific midnight),
// returned as YYYY-MM-DD. Using UTC here would reset hours early/late and
// diverge from the limit Google actually enforces.
export function quotaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

export function getInitials(displayName: string): string {
  if (!displayName) return 'LN'
  const cleaned = displayName.replace(/^(doctor|dr\.?)\s+/i, '').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
    .join('')
}

export function darkenHex(hex: string, amount = 0.18): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount))
}

export function lightenHex(hex: string, amount = 0.88): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount)
}

export function applyWorkspaceTheme(themeIndex: number, customColor?: string) {
  let primary: string, dk: string, lt: string
  if (themeIndex === -1 && customColor) {
    primary = customColor
    dk = darkenHex(customColor)
    lt = lightenHex(customColor)
  } else {
    const theme = WP_THEMES[themeIndex] || WP_THEMES[1]
    primary = theme.primary; dk = theme.dk; lt = theme.lt
  }
  document.documentElement.style.setProperty('--blue', primary)
  document.documentElement.style.setProperty('--blue-dk', dk)
  document.documentElement.style.setProperty('--blue-lt', lt)
}

export function resolveThemePrimary(themeIndex: number, themeColor?: string): string {
  if (themeIndex === -1 && themeColor) return themeColor
  return WP_THEMES[themeIndex]?.primary ?? WP_THEMES[1].primary
}

export function openSettings(tab: string): void {
  window.location.href = '/settings?tab=' + tab
}

export function toOrganizationKey(workplaceName: string): string {
  return workplaceName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

// API keys are ASCII with no internal whitespace. A key pasted with a wrapped
// line-break keeps an interior newline that .trim() cannot remove, and that
// invalid character makes fetch() throw "The string did not match the expected
// pattern" when it is placed in a request header. Strip everything outside
// printable-ASCII-non-space so a malformed paste can never break a request.
export function sanitizeApiKey(raw: string | null | undefined): string {
  return (raw || '').replace(/[^\x21-\x7E]/g, '')
}

export function getGroqKey(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const k = sanitizeApiKey(sessionStorage.getItem('groq_api_key'))
  return k || null
}

export function getGeminiKey(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  const k = sanitizeApiKey(sessionStorage.getItem('gemini_api_key'))
  return k || null
}

// Some browsers (seen on Brave) don't reject a permission-gated clipboard call
// when access is blocked — they leave it pending indefinitely instead, which
// would leave the caller stuck forever with no fallback ever running. Race it
// against a short timeout so a hang is always treated the same as a rejection.
export function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

export function detectIdPattern(example: string): {
  regex: string
  template: string
  description: string
} | null {
  if (!example) return null

  const tokens: Array<{ type: 'digit' | 'alpha' | 'sep'; chars: string }> = []

  for (const ch of example) {
    const type = /[0-9]/.test(ch) ? 'digit' : /[A-Za-z]/.test(ch) ? 'alpha' : 'sep'
    const last = tokens[tokens.length - 1]
    if (last && last.type === type) {
      last.chars += ch
    } else {
      tokens.push({ type, chars: ch })
    }
  }

  if (tokens.length === 0) return null

  let regex = '^'
  let template = ''
  const parts: string[] = []

  for (const token of tokens) {
    const n = token.chars.length
    if (token.type === 'digit') {
      regex += `\\d{${n}}`
      template += '#'.repeat(n)
      parts.push(`${n} digit${n === 1 ? '' : 's'}`)
    } else if (token.type === 'alpha') {
      regex += `[A-Za-z]{${n}}`
      template += 'A'.repeat(n)
      parts.push(`${n} letter${n === 1 ? '' : 's'}`)
    } else {
      regex += token.chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      template += token.chars
    }
  }

  regex += '$'

  return { regex, template, description: parts.join(' + ') }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FIELD_LABELS: Record<string, string> = {
  patient: 'Patient', reg_number: 'Reg Number', date: 'Date', time: 'Time',
  clinician: 'Clinician', session_number: 'Session Number', attendance: 'Attendance',
  diagnosis: 'Diagnosis', presentation: 'Presentation', history: 'History',
  medications: 'Medications', mse: 'Mental State Examination', content: 'Session Content',
  scales: 'Rating Scales', risk: 'Risk Assessment', referrals: 'Referrals & Correspondence',
  summary: 'Summary', nextsteps: 'Next Steps',
}

// The AI frequently restates a section's own title as the first line of that
// section's body (e.g. a "Session Content" field whose text opens with
// "Session Content:"). Since every field already renders its label as a header,
// that first line displays as a duplicate. We strip it deterministically.
//
// Each list holds the title variants the model is known to echo for that field —
// the canonical display label plus the section headings used across the 116
// templates and the common synonyms a model might produce. Matching is strict:
// the first line, once stripped of markdown/emphasis/trailing punctuation, must
// EXACTLY equal one of these. Bulleted/numbered first lines (legitimate sub-items
// like "• Presenting complaint: …") are never touched.
const REDUNDANT_SECTION_LABELS: Record<string, string[]> = {
  patient:      ['patient', 'patient name', 'name', 'client', 'client name'],
  diagnosis:    ['diagnosis', 'diagnoses', 'provisional diagnosis', 'working diagnosis', 'clinical diagnosis', 'diagnostic impression', 'diagnostic impressions'],
  presentation: ['presentation', 'current presentation', 'presenting complaint', 'presenting complaints', 'presenting problem', 'presenting problems', 'presenting concerns', 'presenting issues', 'reason for presentation', 'reason for referral'],
  history:      ['history', 'past medical & psychiatric history', 'past medical and psychiatric history', 'past medical history', 'past psychiatric history', 'background', 'background history', 'history of presenting illness', 'relevant history', 'psychiatric history'],
  medications:  ['medications', 'medication', 'current medications', 'medication list', 'medication history'],
  mse:          ['mental state examination', 'mental status examination', 'mental state exam', 'mental status exam', 'mse'],
  content:      ['session content', 'content', 'session content, goals, obstacles/progress, and interventions', 'session detail', 'session details', 'body of session'],
  scales:       ['rating scales', 'scales', 'rating scale', 'psychometric scales', 'psychometric assessment', 'outcome measures'],
  risk:         ['risk assessment', 'risk', 'risk assessment and management', 'risk assessment & management', 'risk & management', 'risk and management'],
  referrals:    ['referrals & correspondence', 'referrals and correspondence', 'referrals', 'referral', 'correspondence'],
  summary:      ['summary', 'session summary', 'clinical summary', 'impression', 'formulation', 'formulation / impression'],
  nextsteps:    ['next steps', 'next steps / plan', 'next steps/plan', 'plan', 'management plan', 'treatment plan', 'recommendations', 'nextsteps'],
}

function isListLine(line: string): boolean {
  return /^\s*([-*•]\s|\d+[.)]\s)/.test(line)
}

function normaliseLabelLine(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')                   // markdown heading hashes
    .replace(/\*\*/g, '').replace(/[*_`]/g, '')  // bold / italic / code markers
    .replace(/\s*\([^)]*\)\s*$/, '')             // trailing parenthetical e.g. "(MSE)"
    .replace(/[\s:：\-–—.]+$/, '')                // trailing colon / dash / period / space
    .trim()
    .toLowerCase()
}

// Remove a redundant leading title from a single field's body. Idempotent, so it
// is safe to run at both parse time (clean storage) and render time (clean any
// note already saved with the duplicate baked in).
export function stripRedundantSectionLabel(field: string, value: string): string {
  if (!value) return value
  const labels = REDUNDANT_SECTION_LABELS[field]
  if (!labels) return value

  const nlIdx = value.indexOf('\n')
  const firstLine = nlIdx === -1 ? value : value.slice(0, nlIdx)
  const rest = nlIdx === -1 ? '' : value.slice(nlIdx + 1)

  // Never strip a legitimate bullet / numbered sub-item.
  if (isListLine(firstLine)) return value

  // "Label: inline content" on the first line → keep only the inline content.
  const colonIdx = firstLine.search(/[:：]/)
  if (colonIdx !== -1) {
    const before = normaliseLabelLine(firstLine.slice(0, colonIdx + 1))
    const after = firstLine.slice(colonIdx + 1).replace(/^\s*[*_`]+/, '').trim()
    if (after && labels.includes(before)) {
      return (after + (rest ? '\n' + rest : '')).replace(/^\n+/, '')
    }
  }

  // First line is ONLY the label → drop it entirely.
  if (labels.includes(normaliseLabelLine(firstLine))) {
    return rest.replace(/^\n+/, '')
  }

  return value
}

function applyInlineBold(line: string): string {
  // Bold consumes ** pairs first so any single * left over afterwards is
  // genuinely an italic marker, never half of a bold pair.
  return line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

function formatContent(text: string): string {
  const lines = escapeHtml(text).split('\n')
  let html = '', inList = false
  const LI = 'style="display:flex;gap:0.3rem;margin-bottom:2px"'
  const NUM = 'style="flex-shrink:0;min-width:1.5rem"'
  const TXT = 'style="flex:1;min-width:0"'
  lines.forEach(line => {
    const subheading = line.match(/^#{1,3}\s+(.+)/)
    const numMatch = line.match(/^(\d+\.)\s+(.*)$/)
    const bulletMatch = !numMatch && line.match(/^[-•]\s+(.*)$/)
    if (subheading) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<p style="font-weight:600;margin-top:0.75em;margin-bottom:0.15em;">${applyInlineBold(subheading[1])}</p>`
    } else if (numMatch) {
      if (!inList) { html += '<ul style="list-style:none;padding:0;margin:0 0 4px">'; inList = true }
      html += `<li ${LI}><span ${NUM}>${numMatch[1]}</span><span ${TXT}>${applyInlineBold(numMatch[2])}</span></li>`
    } else if (bulletMatch) {
      if (!inList) { html += '<ul style="list-style:none;padding:0;margin:0 0 4px">'; inList = true }
      html += `<li ${LI}><span ${NUM}>•</span><span ${TXT}>${applyInlineBold(bulletMatch[1])}</span></li>`
    } else {
      if (inList) { html += '</ul>'; inList = false }
      if (line.trim()) html += `<p>${applyInlineBold(line)}</p>`
    }
  })
  if (inList) html += '</ul>'
  return html
}

const NOTE_TEXT_LABELS: Record<string, string> = {
  patient: 'PATIENT', reg_number: 'REG NUMBER', date: 'DATE', time: 'TIME',
  clinician: 'CLINICIAN', session_number: 'SESSION NUMBER', attendance: 'ATTENDANCE',
  diagnosis: 'DIAGNOSIS', presentation: 'PRESENTATION', history: 'HISTORY',
  medications: 'MEDICATIONS', mse: 'MENTAL STATE EXAMINATION', content: 'SESSION CONTENT',
  scales: 'RATING SCALES', risk: 'RISK ASSESSMENT', referrals: 'REFERRALS & CORRESPONDENCE',
  summary: 'SUMMARY', nextsteps: 'NEXT STEPS',
}

// Header (non-clinical) fields that always render first, in fixed order.
const NOTE_HEADER_KEYS = ['patient', 'reg_number', 'date', 'time', 'clinician', 'session_number', 'attendance']

// The clinical body sections of a note in render order: the note's stored
// template order (core + extra keys) when present, then any content-bearing core
// fields not in that order (canonical order). Old notes (no extraSections) fall
// back to canonical order — identical to today. `coreLabel` maps a core field
// key to its display label; extra sections carry their own stored label.
export function orderedNoteSections(
  f: Partial<Note>,
  coreLabel: (key: string) => string,
): { key: string; label: string; content: string }[] {
  const { order, extras } = parseExtraSectionsField(f.extraSections)
  const extraByKey = new Map(extras.map(e => [e.key, e]))
  const coreSet = new Set<string>(CORE_NOTE_FIELDS as string[])
  const out: { key: string; label: string; content: string }[] = []
  const seen = new Set<string>()
  const addCore = (key: string) => {
    const val = stripRedundantSectionLabel(key, (f as Record<string, string>)[key] || '')
    if (val.trim()) out.push({ key, label: coreLabel(key), content: val.trim() })
  }
  const addExtra = (e: { key: string; label: string; content: string }) => {
    if (e.content && e.content.trim()) out.push({ key: e.key, label: e.label, content: e.content.trim() })
  }
  const keys = order.length ? order : (CORE_NOTE_FIELDS as string[])
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    if (coreSet.has(key)) addCore(key)
    else if (extraByKey.has(key)) addExtra(extraByKey.get(key)!)
  }
  for (const e of extras) { if (!seen.has(e.key)) { seen.add(e.key); addExtra(e) } }
  for (const key of CORE_NOTE_FIELDS as string[]) { if (!seen.has(key)) { seen.add(key); addCore(key) } }
  return out
}

// Plain-text assembly of a letter body. Mirrors the edit page's flowLetterBody
// so a saved letter's `content` (used for the Patients snippet, History preview,
// and AI-assistant search) reads like the letter the doctor produced. Not the
// exported document — the PDF/email builders own that — just a faithful text copy.
export function buildLetterText(params: {
  letterType: LetterType
  common: LetterCommonFields
  referral?: ReferralFields
  records?: RecordsFields
  freetext?: FreetextFields
  customSections?: { heading: string; content: string }[]
}): string {
  const { letterType, common, referral, records, freetext, customSections } = params
  const lines: string[] = []
  const push = (t: string) => lines.push(t)
  const gap = () => { if (lines.length && lines[lines.length - 1] !== '') lines.push('') }

  if (letterType !== 'freetext') {
    push(`Re: ${common.patientName || ''}`.trim())
    if (common.dob) push(`DOB: ${common.dob}`)
  } else if (common.patientName) {
    push(`Subject: ${common.patientName}`)
  }
  gap()

  if (letterType === 'referral' && referral) {
    push(letterSalutation(common.recipientName)); gap()
    push(`I am writing to refer to you ${common.patientName || ''}, who was admitted to the ${referral.admissionUnit || ''} from the ${formatDateForLetter(referral.admissionDateStart)} to the ${formatDateForLetter(referral.admissionDateEnd)}.`.replace(/\s+/g, ' ').trim())
    gap()
    const age = calculateAgeFromDOB(common.dob)
    const agePart = age !== null ? `${age} year old ` : ''
    const firstName = (common.patientName || '').split(' ')[0] || 'Patient'
    const title = referral.gender === 'male' ? 'Mr.' : referral.gender === 'female' ? 'Ms.' : ''
    push(`Thank you for seeing ${title} ${common.patientName || ''}. ${firstName} is a ${agePart}${referral.gender || ''} who presented with ${referral.presentingComplaint || ''}.`.replace(/\s+/g, ' ').trim())
    if (referral.secondParagraph) { gap(); push(referral.secondParagraph) }
    if (referral.referralReason) { gap(); push(`${referral.referralReason}${referral.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`) }
    if (referral.showPastMedicalHistory && referral.pastMedicalHistory) {
      gap(); push('Past Medical History:')
      referral.pastMedicalHistory.split('\n').map(l => l.trim()).filter(Boolean).forEach(push)
    }
    if (referral.showMedicationList && referral.medicationList) {
      gap(); push('Medication List:')
      autoNumberLines(referral.medicationList).split('\n').map(l => l.trim()).filter(Boolean).forEach(push)
    }
  } else if (letterType === 'records' && records) {
    push('To whom it may concern,'); gap()
    push(`I am writing to request any correspondence or documentation from their previous visits at ${records.recordsLocation || ''}.`.replace(/\s+/g, ' ').trim())
    if (records.secondParagraphRecords) { gap(); push(records.secondParagraphRecords) }
  } else if (letterType === 'freetext' && freetext) {
    freetext.freeTextContent.split('\n').map(l => l.trim()).forEach(l => l ? push(l) : gap())
  } else if (letterType === 'custom') {
    push(letterSalutation(common.recipientName)); gap()
    ;(customSections ?? []).filter(s => s.content.trim()).forEach((s, i) => {
      if (i > 0) gap()
      push(`${s.heading}:`)
      s.content.split('\n').map(l => l.trim()).filter(Boolean).forEach(push)
    })
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function buildNoteText(f: Partial<Note>): string {
  const header = NOTE_HEADER_KEYS
    .map(key => {
      const val = stripRedundantSectionLabel(key, (f as Record<string, string>)[key] || '')
      return val && val.trim() ? `${NOTE_TEXT_LABELS[key]}\n${val.trim()}` : ''
    })
    .filter(Boolean)
  const body = orderedNoteSections(f, key => NOTE_TEXT_LABELS[key] ?? key.toUpperCase())
    .map(({ label, content }) => `${label.toUpperCase()}\n${content}`)
  return [...header, ...body].filter(Boolean).join('\n\n')
}

export function buildCoverLetterEmail(
  f: Partial<Note>,
  profile: { displayName?: string; credentials?: string; emailPretext?: string }
): string {
  const pretext = profile.emailPretext || 'I reviewed this patient today and wanted to share the following progress note.'
  const body = buildNoteText(f)
  const sign = [profile.displayName, profile.credentials].filter(Boolean).join('\n')
  return `${pretext}\n\n${body}\n\nRegards,\n${sign}`
}

// Body salutation for referral/records letters. Addresses the RECIPIENT (who
// the letter is sent to — recipientName usually already carries the title, e.g.
// "Dr Eleanor Vance"), not the admitting doctor. Falls back to a generic
// greeting rather than leaving a "[Doctor Name]" placeholder in the letter.
// Display label for a saved letter in list surfaces (Patients / History). Custom
// and free-text letters share the generic "Letter" label since the doc doesn't
// carry a distinct title in the list.
export const LETTER_TYPE_LABEL: Record<LetterType, string> = {
  referral: 'Referral Letter',
  records: 'Records Request',
  freetext: 'Letter',
  custom: 'Letter',
}

export function letterSalutation(recipientName?: string): string {
  const r = (recipientName || '').trim()
  return r ? `Dear ${r},` : 'Dear Sir/Madam,'
}

export function formatDateForLetter(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return '[Date]'
  const parts = dateStr.split('/')
  if (parts.length !== 3) return dateStr
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]
  const day = parseInt(parts[0], 10)
  const month = months[parseInt(parts[1], 10) - 1] || '[Month]'
  const suffix = (d: number) => {
    if (d > 3 && d < 21) return 'th'
    switch (d % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }
  return `${day}${suffix(day)} of ${month} ${parts[2]}`
}

export function calculateAgeFromDOB(dob: string): number | null {
  if (!dob || dob.length !== 10) return null
  const parts = dob.split('/')
  if (parts.length !== 3) return null
  const d = new Date(
    parseInt(parts[2], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[0], 10)
  )
  if (isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  if (
    today.getMonth() < d.getMonth() ||
    (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())
  ) age--
  return age
}

// Auto-numbers un-numbered lines in a text block (used for medication lists).
// Lines that already start with "1." / "1)" etc. are left as-is.
export function autoNumberLines(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return text
  return lines.map((line, i) =>
    /^\d+[\.\)]\s/.test(line) ? line : `${i + 1}. ${line}`
  ).join('\n')
}

// Auto-fill the session Time field ("HH:MM – HH:MM") to match the TimePicker,
// which only offers 5-minute slots between 07:00 and 21:00.
//   - end   = when the session concluded (recording end, or submission time),
//             rounded to the nearest 5-minute slot.
//   - start = recording start (end − duration) when we have a duration; with no
//             duration (pasted/typed notes) we assume the top of that hour.
// Returns '' when either edge falls outside the picker's 07:00–21:00 range, so
// out-of-hours sessions are simply left for manual entry.
export function autoSessionTime(endMs: number, durationSec: number): string {
  const toSlot = (d: Date): string | null => {
    let h = d.getHours()
    let m = Math.round(d.getMinutes() / 5) * 5
    if (m === 60) { m = 0; h += 1 }
    if (h < 7 || h > 21 || (h === 21 && m > 0)) return null
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const end = new Date(endMs)
  let start: Date
  if (durationSec > 0) {
    start = new Date(endMs - durationSec * 1000)
  } else {
    start = new Date(endMs)
    start.setMinutes(0, 0, 0)
  }
  const s = toSlot(start)
  const e = toSlot(end)
  if (!s || !e || s === e) return ''
  return `${s} – ${e}`
}

export function buildLetterPreviewHTML(params: {
  letterType: LetterType
  common: LetterCommonFields
  referral?: ReferralFields
  records?: RecordsFields
  freetext?: FreetextFields
  letterheadHeaderUrl?: string | null
  letterheadFooterUrl?: string | null
  custom?: { sections: { heading: string; content: string }[] }
  signatureUrl?: string | null
  signatureScale?: number
  fontSize?: number
  lineHeight?: number
  margin?: number
  clinicianName?: string
  credentials?: string
  providerNumber?: string
  workPhone?: string
  position?: string
  workplaceName?: string
}): string {
  const {
    letterType, common, referral, records, freetext, custom,
    letterheadHeaderUrl, letterheadFooterUrl,
    signatureUrl, signatureScale, fontSize, lineHeight, margin, clinicianName, credentials,
    providerNumber, workPhone, position, workplaceName,
  } = params

  const baseFont = fontSize && fontSize > 0 ? fontSize : 11
  const baseLine = lineHeight && lineHeight > 0 ? lineHeight : 1.4
  const baseMargin = margin && margin > 0 ? margin : 20
  const smallFont = Math.max(8, baseFont - 1)

  const headerHtml = letterheadHeaderUrl
    ? `<img src="${escapeHtml(letterheadHeaderUrl)}" style="width:100%;display:block;" alt="Header" />`
    : `<div style="padding:14px 24px;border-bottom:2px solid #0072BB;display:flex;justify-content:space-between;align-items:center;">
         <strong style="font-size:15px;color:#1e293b;">${escapeHtml(clinicianName || 'LushNote')}</strong>
         ${credentials ? `<span style="font-size:11px;color:#64748b;">${escapeHtml(credentials)}</span>` : ''}
       </div>`

  const footerHtml = letterheadFooterUrl
    ? `<div style="margin-top:-14mm;position:relative;z-index:1;"><img src="${escapeHtml(letterheadFooterUrl)}" style="width:100%;max-height:110px;display:block;margin:0 auto;" alt="Footer" /></div>`
    : `<div style="padding:8px 24px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;text-align:center;">
         ${escapeHtml(clinicianName || '')}${credentials ? ', ' + escapeHtml(credentials) : ''}
       </div>`

  // Preview-only sizing: the signature block is kept compact here so it never
  // collides with the footer letterhead on screen. The PDF export has its own
  // sizing (lib/letterExport.ts) and is unaffected.
  const sigHeight = Math.round(34 * ((signatureScale && signatureScale > 0 ? signatureScale : 100) / 100))
  const signatureHtml = signatureUrl
    ? `<img src="${escapeHtml(signatureUrl)}" style="height:${sigHeight}px;object-fit:contain;display:block;margin:0 auto 2px;" alt="Signature" />`
    : ''

  const recipientBlock = `
    <p style="margin:0 0 4px;">${escapeHtml(common.letterDate || '')}</p><br>
    <p style="margin:0 0 2px;"><strong>To:</strong></p>
    <p style="margin:0 0 2px;">${escapeHtml(common.recipientName || '[Recipient Name]')}</p>
    ${common.recipientAddress
      ? `<p style="margin:0 0 16px;white-space:pre-line;">${escapeHtml(common.recipientAddress)}</p>`
      : '<br>'}
  `

  const reBlock = letterType !== 'freetext'
    ? `<p style="font-weight:700;margin:0 0 4px;">Re: ${escapeHtml(common.patientName || '[Patient Name]')}</p>
       ${common.dob ? `<p style="font-weight:700;margin:0 0 16px;">DOB: ${escapeHtml(common.dob)}</p>` : '<br>'}`
    : `<p style="font-weight:700;margin:0 0 16px;">Subject: ${escapeHtml(common.patientName || '[Subject]')}</p>`

  let bodyHtml = ''

  const p = (content: string) => `<p style="margin:0 0 0.8em;">${content}</p>`

  if (letterType === 'referral' && referral) {
    const title = referral.gender === 'male' ? 'Mr.' : referral.gender === 'female' ? 'Ms.' : ''
    const firstName = (common.patientName || '').split(' ')[0] || 'Patient'
    const age = calculateAgeFromDOB(common.dob)
    const agePart = age !== null ? `${age} year old ` : ''
    const medList = referral.showMedicationList && referral.medicationList
      ? autoNumberLines(referral.medicationList)
      : ''
    // applyInlineBold runs after escapeHtml (never before - escaping must see
    // the raw **/*  markers, not HTML-encoded ones) so **bold**/*italic*
    // typed via the Bold/Italic shortcut renders the same as it does in the
    // clinical note fields and the PDF export.
    bodyHtml = `
      ${p(escapeHtml(letterSalutation(common.recipientName)))}
      ${p(`I am writing to refer to you ${applyInlineBold(escapeHtml(common.patientName || '[Patient Name]'))}, who was admitted to the ${applyInlineBold(escapeHtml(referral.admissionUnit || '[Unit]'))} from the ${formatDateForLetter(referral.admissionDateStart)} to the ${formatDateForLetter(referral.admissionDateEnd)}.`)}
      ${p(`Thank you for seeing ${title} ${applyInlineBold(escapeHtml(common.patientName || '[Patient Name]'))}. ${applyInlineBold(escapeHtml(firstName))} is a ${agePart}${applyInlineBold(escapeHtml(referral.gender || '[gender]'))} who presented with ${applyInlineBold(escapeHtml(referral.presentingComplaint || '[presenting complaint]'))}.`)}
      ${referral.secondParagraph ? p(applyInlineBold(escapeHtml(referral.secondParagraph))) : ''}
      ${p(`${applyInlineBold(escapeHtml(referral.referralReason || '[reason for referral]'))}${referral.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`)}
      ${referral.showPastMedicalHistory && referral.pastMedicalHistory
        ? `${p('<strong><u>Past Medical History:</u></strong>')}<p style="margin:0 0 0.8em;white-space:pre-line;">${applyInlineBold(escapeHtml(referral.pastMedicalHistory))}</p>`
        : ''}
      ${medList
        ? `${p('<strong><u>Medication List:</u></strong>')}<p style="margin:0 0 0.8em;white-space:pre-line;">${applyInlineBold(escapeHtml(medList))}</p>`
        : ''}
      ${p('Please do not hesitate to contact me if there are any queries regarding this referral.')}
    `
  } else if (letterType === 'records' && records) {
    bodyHtml = `
      ${p('To whom it may concern,')}
      ${p(`I am writing to request any correspondence or documentation from their previous visits at ${applyInlineBold(escapeHtml(records.recordsLocation || '[Location]'))}. It would be greatly appreciated if any correspondence, treatments, and recent investigations could be provided to assist with their ongoing management.`)}
      ${records.secondParagraphRecords ? p(applyInlineBold(escapeHtml(records.secondParagraphRecords))) : ''}
    `
  } else if (letterType === 'freetext' && freetext) {
    bodyHtml = freetext.freeTextContent
      ? freetext.freeTextContent.split('\n')
          .map(l => l.trim() ? p(applyInlineBold(escapeHtml(l))) : '<br>').join('')
      : '<p style="color:#94a3b8;">[Letter content will appear here]</p>'
  } else if (letterType === 'custom') {
    const filled = (custom?.sections ?? []).filter(s => s.content.trim())
    bodyHtml = p(escapeHtml(letterSalutation(common.recipientName)))
      + (filled.length
          ? filled.map(s =>
              `${p(`<strong>${escapeHtml(s.heading)}:</strong>`)}` +
              s.content.split('\n').map(l => l.trim() ? p(applyInlineBold(escapeHtml(l))) : '<br>').join('')
            ).join('')
          : '<p style="color:#94a3b8;">[Letter content will appear here]</p>')
      + p('Please do not hesitate to contact me if you require any further information.')
  }

  return `
    <div style="font-family:Arial,sans-serif;font-size:${baseFont}pt;line-height:${baseLine};color:#000;background:#fff;min-height:297mm;display:flex;flex-direction:column;max-width:210mm;">
      ${headerHtml}
      <div style="padding:8mm ${baseMargin}mm 0;flex:1;display:flex;flex-direction:column;">
        <div>
          ${recipientBlock}
          ${reBlock}
          ${bodyHtml}
        </div>
        <div style="margin-top:auto;padding-top:8px;text-align:center;position:relative;z-index:2;font-size:${Math.max(8, baseFont - 2)}pt;line-height:1.25;">
          ${signatureHtml}
          <p style="margin:0 0 1px;">Thank you and kind regards,</p>
          <p style="margin:0 0 1px;font-weight:700;">${escapeHtml(clinicianName || '')}${credentials ? ` (${escapeHtml(credentials)})` : ''}</p>
          ${(providerNumber || workPhone) ? `<p style="margin:0 0 1px;">${providerNumber ? 'Provider No: ' + escapeHtml(providerNumber) : ''}${providerNumber && workPhone ? ' | ' : ''}${workPhone ? 'Ph no: ' + escapeHtml(workPhone) : ''}</p>` : ''}
          ${position ? `<p style="margin:0 0 1px;font-size:${Math.max(7, baseFont - 3)}pt;">${escapeHtml(position)}</p>` : ''}
          ${workplaceName ? `<p style="margin:0;font-size:${Math.max(7, baseFont - 3)}pt;">${escapeHtml(workplaceName)}</p>` : ''}
        </div>
      </div>
      ${footerHtml}
    </div>
  `
}

export function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length >= 5) return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
  if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits
}

// Builds the full generation prompt for a template, appending any saved
// custom-field instructions so derived templates always include those sections.
// Only the handful of templates that mark their sections with [fieldname]
// brackets get the bracket-format instruction. Heading-based templates (the
// large majority) carry their own ### headings and must not be told to use
// brackets, or the two instructions conflict.
const BRACKET_FIELD_RX = /\[(?:presentation|history|medications|mse|content|scales|risk|referrals|summary|nextsteps|diagnosis)\]/

// Appended to EVERY generation prompt: our note fields are plain text, so a
// markdown table the model copies from a template renders as walls of dashes.
const NO_TABLE_INSTRUCTION = `Never output markdown tables (no "|" pipe columns and no "|---|" separator rows). Where a template shows a table, write one labelled line per column for each row instead — e.g. "Situation: …" / "Thought: …" / "Emotion: …" / "Behaviour: …" — with a blank line between rows.`

// Section-marker instruction. When a template declares sections, list its exact
// markers so the model emits parseable [key] lines instead of ### headings.
function bracketFormatInstruction(markers: string[]): string {
  const list = markers.map(m => `[${m}]`).join(', ')
  return `Format:
- Begin each section on its own line with its exact marker: ${list}.
- Use ONLY these bracket markers as section dividers — no ## markdown headings and no **bold** heading lines.
- Omit any section that has nothing to report (just leave its marker out) — do not write "None" or an empty heading.
- Within a section you may use bold (**Label:**) for sub-headings.`
}

export function buildTemplatePrompt(template: AnyTemplate): string {
  const base = (template.prompt ?? '').trim()
  let prompt = base

  if ('customFields' in template && template.customFields?.length) {
    const additions = template.customFields.map(f => {
      const targetLabel = FIELD_LABELS[f.targetField] ?? f.targetField
      return `\n\nADDITIONAL SECTION - "${f.label}" (incorporate this content within the ${targetLabel} section):\n${f.systemPrompt.trim()}`
    }).join('')
    prompt = (base + additions).trim()
  }

  // Prefer the precomputed section list (annotate-template-sections.mjs). A
  // content-only template (single 'content' section) needs no marker
  // instruction — its whole output is the note. Fall back to detecting inline
  // [field] markers for templates/custom-templates without a sections array.
  const sections = 'sections' in template ? template.sections : undefined
  const markerKeys = sections && !(sections.length === 1 && sections[0].key === 'content')
    ? sections.map(s => s.key)
    : (BRACKET_FIELD_RX.test(prompt) ? ['presentation', 'history', 'mse', 'content', 'risk', 'summary', 'nextsteps'] : null)

  if (markerKeys) {
    prompt = `${prompt}\n\n${bracketFormatInstruction(markerKeys)}`
  }

  return `${prompt}\n\n${NO_TABLE_INSTRUCTION}`
}

export function buildPreviewHTML(f: Partial<Note>): string {
  const renderSection = (key: string, label: string, content: string) =>
    `<div class="preview-section" data-field="${escapeHtml(key)}"><h3>${escapeHtml(label)}</h3><div class="preview-content">${formatContent(content)}</div></div>`

  const headerSections = NOTE_HEADER_KEYS
    .map(key => ({ key, val: stripRedundantSectionLabel(key, (f as Record<string, string>)[key] || '') }))
    .filter(({ val }) => val.trim())
    .map(({ key, val }) => renderSection(key, FIELD_LABELS[key] ?? key, val))
    .join('')

  const bodySections = orderedNoteSections(f, key => FIELD_LABELS[key] ?? key)
    .map(({ key, label, content }) => renderSection(key, label, content))
    .join('')

  const sections = headerSections + bodySections

  if (!sections) return '<div class="preview-empty"><p>Your note preview will appear here as you fill in the fields.</p></div>'

  return `<div class="preview-note">
    <div class="preview-header">
      <h2>${escapeHtml(f.patient || 'Patient Name')}</h2>
      <div class="preview-meta">${[f.date, f.time, f.clinician].filter(Boolean).map(v => escapeHtml(v!)).join(' · ')}</div>
      ${f.reg_number ? `<div class="preview-reg">ID: ${escapeHtml(f.reg_number)}</div>` : ''}
    </div>
    ${sections}
  </div>`
}