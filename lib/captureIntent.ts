import { classifyPastedText, type PastedKind } from './pastedText'

// What did the doctor just capture, and therefore what should we offer?
//
// The capture button records or photographs and then has to decide, unaided,
// what the doctor meant — because the whole point is that they no longer walk
// through modals telling us. Three things arrive down that one button:
//
//   a consultation   two voices, a session being written up      → a note
//   a dictation      one voice narrating about a patient         → a note or letter
//   a ward note      an existing record being copied             → the patient record
//
// The ward-note question is already answered by classifyPastedText, which reads
// STRUCTURE (problem lists, record labels, headings). This adds the axis it
// cannot see: within something that is being spoken rather than copied, is it a
// conversation or a monologue? That is a question about VOICE, not layout.
//
// Extends rather than duplicates: the ward-note verdict is delegated, so the two
// classifiers cannot disagree about the same text.

export type CaptureIntent =
  /** Two voices — a session with the patient present. */
  | 'consultation'
  /** One voice narrating a note about a patient. */
  | 'dictated-note'
  /** One voice narrating a letter addressed to somebody. */
  | 'dictated-letter'
  /** An admission being summarised at its end — the discharge summary. */
  | 'discharge'
  /** An existing record being copied in. */
  | 'ward-note'

export interface IntentClassification {
  intent: CaptureIntent
  /** 0–1. The card stays neutral when the call is close rather than asserting a
   *  guess, and a misread can be investigated instead of argued about. */
  confidence: number
  /** Which signals fired. "Why did it think that" is the first question asked
   *  when it is wrong. */
  signals: string[]
}

/**
 * A tie goes to `consultation`.
 *
 * Its suggested action is "generate a note", which is discardable. The costly
 * mistakes point the other way: a wrongly-detected ward note offers to write the
 * patient's record, and a wrongly-detected letter offers a document addressed to
 * a third party. Both are worse to get wrong than an unnecessary note.
 */
const UNCERTAIN_IS_CONSULTATION = true

/** Second-person address. Only a person in the room is spoken to like this. */
const SECOND_PERSON = /\b(you|your|you're|you've|you'd|yourself)\b/gi

/** First person from the PATIENT's side. A dictating doctor says "the patient
 *  reports", not "I've been feeling". */
const PATIENT_FIRST_PERSON = /\b(i feel|i felt|i've been|i have been|i was|i'm|i am|my mum|my mother|my dad|my father|my partner|my husband|my wife)\b/gi

/** Third-person clinical reference — how a doctor narrates ABOUT someone. */
const THIRD_PERSON_CLINICAL = /\b(the patient|this patient|he reports|she reports|they report|he denies|she denies|they deny|on examination|mental state|presenting complaint|past medical history)\b/gi

/** Salutation and sign-off — a letter is addressed to somebody. */
const LETTER_MARKERS = [
  'dear dr', 'dear doctor', 'dear sir', 'dear madam', 'dear colleague',
  'thank you for seeing', 'thank you for referring', 'i am writing to refer',
  'i am writing regarding', 'i would be grateful', 'please accept this referral',
  'yours sincerely', 'yours faithfully', 'kind regards', 'many thanks',
  're:', 'to whom it may concern',
]

/** An admission being closed off. A discharge summary is dictated at the END of
 *  a stay and reads backwards over it — the tense is what separates it from a
 *  progress note, which reads forward from today. */
const DISCHARGE_MARKERS = [
  'discharge summary', 'discharged home', 'discharged to', 'on discharge',
  'discharge medications', 'discharge plan', 'date of discharge', 'discharged today',
  'was admitted', 'admitted on', 'date of admission', 'admission on',
  'during this admission', 'this admission', 'inpatient stay', 'length of stay',
  'follow up with the gp', 'follow-up with the gp', 'reason for admission',
]

/** Spoken formatting a doctor uses when dictating structure aloud. */
const DICTATION_CUES = [
  'new paragraph', 'next line', 'full stop', 'comma', 'new line',
  'heading', 'bullet point', 'end of note', 'end of letter',
]

function countMatches(text: string, rx: RegExp): number {
  const m = text.match(rx)
  return m ? m.length : 0
}

function hits(lower: string, needles: string[]): string[] {
  return needles.filter(n => lower.includes(n))
}

/**
 * `source` says how the content arrived, which is evidence the text itself does
 * not carry — the same reason `resolvePastedKind` exists. A photograph is a
 * record being copied; a doctor does not photograph a conversation.
 */
export type CaptureSource = 'audio' | 'photo'

export function classifyCaptureIntent(text: string, source: CaptureSource): IntentClassification {
  const signals: string[] = []
  const raw = (text || '').trim()
  if (!raw) return { intent: 'consultation', confidence: 0, signals: ['empty'] }

  // A photograph is a record being copied. Nothing in a transcript's voice can
  // outweigh the doctor having pointed a camera at a page, so this short-
  // circuits rather than competing with the voice signals below.
  if (source === 'photo') {
    return { intent: 'ward-note', confidence: 1, signals: ['photographed - a record, not speech'] }
  }

  // Structure first, delegated. If the spoken text is really a record being read
  // aloud, that outranks the conversation/monologue question entirely.
  const structural = classifyPastedText(raw)
  if (structural.kind === ('ward-note' satisfies PastedKind) && structural.confidence >= 0.5) {
    return {
      intent: 'ward-note',
      confidence: structural.confidence,
      signals: ['reads as a record', ...structural.signals.slice(0, 3)],
    }
  }

  const lower = raw.toLowerCase()
  const words = raw.split(/\s+/).filter(Boolean).length || 1

  // A discharge summary is checked BEFORE the letter envelope, because it is
  // often both — template 40 is literally "Discharge Summary - Letter to
  // Referrer" — and the more specific answer is the useful one. A referral that
  // merely mentions a past admission ("she was discharged in March") carries one
  // marker and stays a letter; closing off a stay takes at least two.
  const dischargeMarkers = hits(lower, DISCHARGE_MARKERS)
  if (dischargeMarkers.length >= 2) {
    return {
      intent: 'discharge',
      confidence: Math.min(1, 0.45 + 0.15 * dischargeMarkers.length),
      signals: [`summarises an admission: ${dischargeMarkers.slice(0, 3).join(', ')}`],
    }
  }

  // A salutation AND a sign-off settle it before any voice scoring runs.
  //
  // A letter is ADDRESSED to somebody, so it is full of second-person pronouns
  // — "thank you for seeing", "your opinion" — which the conversation signals
  // below read as someone being spoken to in the room. They cannot tell the two
  // apart, and they should not have to: nobody opens a consultation with "Dear
  // Dr Singh" or closes one with "kind regards". The envelope identifies a
  // letter the way a problem list identifies a ward note.
  const letterMarkers = hits(lower, LETTER_MARKERS)
  if (letterMarkers.length >= 2) {
    return {
      intent: 'dictated-letter',
      confidence: Math.min(1, 0.5 + 0.15 * letterMarkers.length),
      signals: [`addressed as a letter: ${letterMarkers.slice(0, 3).join(', ')}`],
    }
  }

  let conversation = 0
  let monologue = 0

  // ── Conversation ────────────────────────────────────────────────────────
  // Questions asked of someone present. A dictation contains few or none —
  // nobody is there to answer.
  const questions = countMatches(raw, /\?/g)
  const questionRate = questions / (words / 100)
  if (questions >= 3 && questionRate >= 0.5) {
    conversation += 3
    signals.push(`${questions} questions asked`)
  } else if (questions >= 1) {
    conversation += 1
    signals.push(`${questions} question${questions === 1 ? '' : 's'}`)
  }

  // Being spoken TO. The single clearest marker of a person in the room.
  const second = countMatches(raw, SECOND_PERSON)
  const secondRate = second / words
  if (secondRate > 0.015) { conversation += 3; signals.push('addressed to someone present') }
  else if (secondRate > 0.005) { conversation += 1; signals.push('some second-person address') }

  // The patient speaking about themselves. A dictating doctor never says this.
  const patientVoice = countMatches(raw, PATIENT_FIRST_PERSON)
  if (patientVoice >= 3) { conversation += 3; signals.push('patient speaking in first person') }
  else if (patientVoice >= 1) { conversation += 1; signals.push('first-person patient speech') }

  // ── Monologue ───────────────────────────────────────────────────────────
  // Narrating ABOUT a patient rather than to them.
  const third = countMatches(raw, THIRD_PERSON_CLINICAL)
  if (third >= 3) { monologue += 3; signals.push('third-person clinical narration') }
  else if (third >= 1) { monologue += 1; signals.push('some third-person narration') }

  // Spoken punctuation and structure — only ever said when dictating.
  const cues = hits(lower, DICTATION_CUES)
  if (cues.length >= 2) { monologue += 3; signals.push(`dictation cues: ${cues.slice(0, 3).join(', ')}`) }
  else if (cues.length === 1) { monologue += 2; signals.push(`dictation cue: ${cues[0]}`) }

  // ── A single letter marker ───────────────────────────────────────────────
  // Two or more returned above. One on its own is weak evidence — "re:" or a
  // stray "many thanks" appears inside plenty of spoken notes — so it only
  // leans, and cannot by itself send the doctor into the letter editor.
  const letter = letterMarkers
  if (letter.length === 1) { monologue += 2; signals.push(`letter marker: ${letter[0]}`) }

  const total = conversation + monologue
  const isConversation = UNCERTAIN_IS_CONSULTATION
    ? conversation >= monologue
    : conversation > monologue
  const confidence = total === 0 ? 0 : Math.abs(conversation - monologue) / total

  if (isConversation) return { intent: 'consultation', confidence, signals }

  // Every letter has already returned above: an envelope takes two markers, and
  // one is not an envelope. So anything reaching here is a note being narrated —
  // offering a letter on the strength of a stray "many thanks" would send the
  // doctor into the wrong editor for a progress note.
  return { intent: 'dictated-note', confidence, signals }
}

/** Enough separation to lead with one action rather than presenting a menu.
 *  Below this the card offers the options without asserting which is right. */
export const INTENT_CONFIDENT = 0.34

export function isConfidentIntent(c: IntentClassification): boolean {
  return c.confidence >= INTENT_CONFIDENT
}
