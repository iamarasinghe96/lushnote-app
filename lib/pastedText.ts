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

/** The identifying block at the top of a hospital record. These labels are the
 *  single most reliable ward-note tell, because a conversation never carries
 *  them and they survive a paste that has lost every newline. */
const RECORD_LABELS = [
  'dob', 'd\\.o\\.b', 'date of birth', 'ur', 'urn', 'mrn', 'reg number',
  'registration number', 'patient id', 'date & time', 'date and time',
  'location', 'ward', 'bed', 'clinician', 'consultant', 'admission',
  'admission timeline', 'age', 'sex', 'nok', 'next of kin',
]

/** Words that only appear when someone is speaking, not writing a record. */
const SPOKEN_MARKERS = [
  'um', 'uh', 'yeah', 'okay so', 'you know', 'i mean', 'sort of', 'kind of',
  'right so', 'mmm', 'mhm', 'like i said',
]

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

/** How many `Label:` pairs from a list appear anywhere in the text. Anchored on
 *  the colon rather than a line start, because a pasted record routinely
 *  arrives with every newline stripped. */
function labelHits(lower: string, labels: string[]): string[] {
  return labels.filter(l => new RegExp(`(^|[^a-z])${l}\\s*:`, 'i').test(lower))
}

/**
 * Classify pasted clinical text.
 *
 * Deliberately structural rather than clever: it counts the shapes a ward note
 * has and a conversation does not. Nothing here calls a model — this runs the
 * instant text is pasted, and a wrong answer must be explainable from the text
 * alone rather than from a prompt someone has to reconstruct later.
 *
 * Every ward signal works WITHOUT newlines. The first version anchored all of
 * them to line starts and was blind to the ordinary case: copying a note out of
 * Bossnet flattens it into a single block — `(Age: 88)UR / Reg Number:` — so
 * every rule scored zero and the record was read as a conversation.
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
  // A problem list is the strongest single signal: no one speaks in '#' lines,
  // and the marker survives flattening.
  const hashes = countMatches(raw, /(^|\s)#{1,2}\s*[A-Za-z]/g)
  if (hashes >= 2) { ward += 3; signals.push(`${hashes} problem-list markers`) }
  else if (hashes === 1) { ward += 1; signals.push('1 problem-list marker') }

  // The identifying block — DOB, UR, Ward, Bed, Clinician. A conversation has
  // none of these, and they are what a flattened paste keeps.
  const idLabels = labelHits(lower, RECORD_LABELS)
  if (idLabels.length >= 3) { ward += 3; signals.push(`record labels: ${idLabels.slice(0, 5).join(', ')}`) }
  else if (idLabels.length >= 1) { ward += 1; signals.push(`record label: ${idLabels[0]}`) }

  const headings = labelHits(lower, WARD_HEADINGS)
  const lineHeadings = WARD_HEADINGS.filter(h =>
    lines.some(l => new RegExp(`^\\*{0,2}${h}\\*{0,2}\\s*:?\\s*$`, 'i').test(l)))
  const allHeadings = Array.from(new Set([...headings, ...lineHeadings]))
  if (allHeadings.length >= 2) { ward += 3; signals.push(`headings: ${allHeadings.slice(0, 4).join(', ')}`) }
  else if (allHeadings.length === 1) { ward += 1; signals.push(`heading: ${allHeadings[0]}`) }

  // A run of numbered items, wherever it sits. A spoken plan is not numbered.
  const numbered = countMatches(raw, /(^|\s)\d+[.)]\s+[A-Za-z]/g)
  if (numbered >= 3) { ward += 2; signals.push(`${numbered} numbered items`) }

  // Short standalone lines are how a record is written; speech runs on. Only
  // meaningful when the paste kept its line structure.
  const shortLines = lines.filter(l => l.length < 60).length
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
  const pronouns = countMatches(lower, /\b(i|you|we)\b/g)
  if (words > 0 && pronouns / words > 0.03) { talk += 2; signals.push('heavy first/second person') }

  const questions = countMatches(raw, /\?/g)
  if (questions >= 3) { talk += 2; signals.push(`${questions} questions`) }

  // One long unbroken block is what a transcription service produces — but it
  // is ALSO what a flattened record looks like, so it only counts when the
  // record labels are absent.
  if (lines.length <= 3 && words > 150 && idLabels.length < 2) {
    talk += 2
    signals.push('one long unbroken block')
  }

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
