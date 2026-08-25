// Is this pasted text a ward note, or a consultation transcript?
//
// Both arrive through the same Paste text box and until now were treated
// identically — every paste became a clinical note. But the two are different
// documents doing different jobs: a transcript is a conversation to be written
// up, while a ward note is an existing clinical record being COPIED into the
// patient's tracked fields.
//
// This decides which, and therefore what the default action does. Getting it
// wrong in the ward-note direction is the expensive one: the patient-record
// path supersedes tracked fields, so a misread transcript could overwrite a
// record. A misread ward note only produces a note the doctor can discard.
// Everything below is biased accordingly — see UNCERTAIN_IS_TRANSCRIPT.

export type PastedKind = 'ward-note' | 'transcript'

export interface PastedClassification {
  kind: PastedKind
  /** 0–1. Reported so the UI can stay quiet when the call is close, and so a
   *  misclassification can be investigated rather than guessed at. */
  confidence: number
  /** Which signals fired, in the order they are weighed. Kept because "why did
   *  it think that" is the first question asked when it is wrong. */
  signals: string[]
}

/**
 * A tie, or anything short of a clear ward note, is treated as a transcript.
 *
 * That is today's behaviour, so an uncertain classification changes nothing —
 * and it puts the cost of being wrong on the recoverable side.
 */
const UNCERTAIN_IS_TRANSCRIPT = true

/** Headings a ward round is written under. From the fidelity contract in
 *  CLAUDE.md — these are the ones real notes actually use. */
const WARD_HEADINGS = [
  'current issues', 'issues', 'problems', 'problem list', 'progress', 'obs',
  'observations', 'impression', 'plan', 'assessment', 'investigations',
  'allergies', 'past medical history', 'social history', 'family history',
  'medications', 'vitals', 'examination',
]

/** Words that only appear when someone is speaking, not writing a record. */
const SPOKEN_MARKERS = [
  'um', 'uh', 'yeah', 'okay so', 'you know', 'i mean', 'sort of', 'kind of',
  'right so', 'mmm', 'mhm', 'like i said',
]

function countLines(lines: string[], test: (l: string) => boolean): number {
  return lines.filter(test).length
}

/**
 * Classify pasted clinical text.
 *
 * Deliberately structural rather than clever: it counts the shapes a ward note
 * has and a conversation does not. Nothing here calls a model — this runs the
 * instant text is pasted, and a wrong answer must be explainable from the text
 * alone rather than from a prompt someone has to reconstruct later.
 */
export function classifyPastedText(text: string): PastedClassification {
  const signals: string[] = []
  const raw = (text || '').trim()
  if (!raw) return { kind: 'transcript', confidence: 0, signals: ['empty'] }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const lower = raw.toLowerCase()
  const words = raw.split(/\s+/).filter(Boolean).length

  let ward = 0
  let talk = 0

  // ── Ward-note shapes ────────────────────────────────────────────────────
  // A problem list is the single strongest signal: no one speaks in '#' lines.
  const hashLines = countLines(lines, l => /^#{1,2}\s*\S/.test(l))
  if (hashLines >= 2) { ward += 3; signals.push(`${hashLines} problem-list lines`) }
  else if (hashLines === 1) { ward += 1; signals.push('1 problem-list line') }

  const headings = WARD_HEADINGS.filter(h =>
    lines.some(l => new RegExp(`^\\*{0,2}${h}\\*{0,2}\\s*:?\\s*$`, 'i').test(l)),
  )
  if (headings.length >= 2) { ward += 3; signals.push(`headings: ${headings.slice(0, 4).join(', ')}`) }
  else if (headings.length === 1) { ward += 1; signals.push(`heading: ${headings[0]}`) }

  const numbered = countLines(lines, l => /^\d+[.)]\s+\S/.test(l))
  if (numbered >= 3) { ward += 2; signals.push(`${numbered} numbered items`) }

  // Short standalone lines are how a record is written; speech runs on.
  const shortLines = countLines(lines, l => l.length < 60)
  if (lines.length >= 5 && shortLines / lines.length > 0.7) {
    ward += 1
    signals.push('mostly short lines')
  }

  // ── Conversation shapes ─────────────────────────────────────────────────
  const spoken = SPOKEN_MARKERS.filter(m => new RegExp(`\\b${m}\\b`, 'i').test(lower))
  if (spoken.length >= 2) { talk += 3; signals.push(`spoken markers: ${spoken.slice(0, 4).join(', ')}`) }
  else if (spoken.length === 1) { talk += 1; signals.push(`spoken marker: ${spoken[0]}`) }

  // First and second person is the giveaway: a record describes a patient, a
  // conversation addresses one.
  const pronouns = (lower.match(/\b(i|you|we)\b/g) ?? []).length
  if (words > 0 && pronouns / words > 0.03) { talk += 2; signals.push('heavy first/second person') }

  const questions = (raw.match(/\?/g) ?? []).length
  if (questions >= 3) { talk += 2; signals.push(`${questions} questions`) }

  // One long unbroken block is what a transcription service produces.
  if (lines.length <= 3 && words > 150) { talk += 2; signals.push('one long unbroken block') }

  // ── Verdict ─────────────────────────────────────────────────────────────
  const total = ward + talk
  const isWard = UNCERTAIN_IS_TRANSCRIPT ? ward > talk : ward >= talk
  const kind: PastedKind = isWard ? 'ward-note' : 'transcript'
  const confidence = total === 0 ? 0 : Math.abs(ward - talk) / total

  return { kind, confidence, signals }
}

/** Enough separation to act on without asking. Below this the UI keeps its
 *  default wording rather than announcing a guess it is not sure of. */
export const CONFIDENT = 0.34

export function isConfidentWardNote(c: PastedClassification): boolean {
  return c.kind === 'ward-note' && c.confidence >= CONFIDENT
}
