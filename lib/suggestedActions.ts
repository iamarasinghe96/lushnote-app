import type { CaptureIntent, IntentClassification } from './captureIntent'
import { isConfidentIntent } from './captureIntent'

// What the card offers after a capture.
//
// The doctor taps once and that tap IS the confirmation — everything before it
// (naming the patient, choosing a template, picking a letter type) has already
// run unattended. So the ORDER of these buttons is the whole design: the primary
// is what happens if they barely look, and it has to be the safe one.
//
// Kept out of the card component because "which action leads" is a clinical
// decision, not a rendering detail, and it is the part worth testing.

export type ActionKey =
  /** Generate a clinical note from the capture. Discardable. */
  | 'note'
  /** Fill the patient's tracked record. SUPERSEDES existing fields. */
  | 'patient-record'
  /** Open the letter editor with the dictation loaded. */
  | 'letter'
  /** Generate the discharge summary from the admission just narrated. */
  | 'discharge-summary'
  /** Fill the record AND hand back the handover sheet. SUPERSEDES fields. */
  | 'patient-pdf'
  /** Open the hospital form for the doctor's active workplace. */
  | 'hospital-form'
  /** Show every option — the escape hatch when the guess is wrong. */
  | 'other'

export interface SuggestedAction {
  key: ActionKey
  label: string
  /** True for the one that leads. Exactly one action is primary. */
  primary: boolean
  /** Set when tapping this cannot simply be discarded, so the card can mark it. */
  overwritesRecord?: boolean
}

const NOTE: SuggestedAction = { key: 'note', label: 'Generate note', primary: false }
const RECORD: SuggestedAction = { key: 'patient-record', label: 'Add to patient record', primary: false, overwritesRecord: true }
const LETTER: SuggestedAction = { key: 'letter', label: 'Write letter', primary: false }
const DISCHARGE: SuggestedAction = { key: 'discharge-summary', label: 'Discharge summary', primary: false }
// One button for the ward round's two halves. Marked as overwriting because the
// first half is a record write — the PDF that follows it changes nothing.
const HANDOVER: SuggestedAction = { key: 'patient-pdf', label: 'Record + handover sheet', primary: false, overwritesRecord: true }
const OTHER: SuggestedAction = { key: 'other', label: 'Something else', primary: false }

// The doctor's own campus form — AWH FAW0004 and whatever follows it. Labelled
// with the form's real NAME, not "Hospital form": the doctor knows their form by
// what it is called, and a generic label would make one campus's paperwork look
// like a feature of the app.
function hospitalForm(name: string): SuggestedAction {
  return { key: 'hospital-form', label: name, primary: false }
}

function lead(a: SuggestedAction): SuggestedAction {
  return { ...a, primary: true }
}

/**
 * The actions to offer, most likely first.
 *
 * **"Something else" is always last and always present.** The classifier will be
 * wrong sometimes, and a doctor who has just recorded a consultation must never
 * be stuck with a card that only offers the wrong thing. It is the difference
 * between a suggestion and a decision made on their behalf.
 *
 * **A low-confidence capture leads with nothing.** Every action comes back
 * non-primary, so the card presents choices instead of asserting a guess it
 * cannot support — the same restraint `CONFIDENT` buys the paste classifier.
 */
export function suggestedActions(
  c: IntentClassification,
  opts?: {
    /** The active workplace's hospital form, by name, when it has one. The
     *  campus decides whether this exists at all, so it cannot be derived from
     *  the capture — it is passed in. */
    hospitalFormName?: string | null
  },
): SuggestedAction[] {
  const confident = isConfidentIntent(c)

  const ordered = orderFor(c.intent, opts?.hospitalFormName ?? null)
  if (!confident) return [...ordered.map(a => ({ ...a, primary: false })), OTHER]

  return [lead(ordered[0]), ...ordered.slice(1), OTHER]
}

/**
 * `formName` is null for the great majority of doctors, whose workplace has no
 * campus form configured — so every branch reads as it did before, and the form
 * is inserted only where it belongs.
 *
 * **It never leads.** Whether an entry belongs on the hospital's own paper form
 * or in LushNote's record is a decision about where this note is going to live,
 * and that is not a guess a classifier can make from the words. It is offered,
 * plainly labelled with the form's name, one tap away.
 */
function orderFor(intent: CaptureIntent, formName: string | null): SuggestedAction[] {
  const FORM = formName ? [hospitalForm(formName)] : []
  switch (intent) {
    // A session with the patient. One tap to the note; the record stays offered
    // because a consultation can legitimately update tracked fields too.
    case 'consultation':
      return [NOTE, ...FORM, RECORD]

    // Narrated about a patient — still a note, but the record is the more
    // plausible second choice than a letter nobody addressed.
    case 'dictated-note':
      return [NOTE, ...FORM, RECORD]

    // Addressed to someone. The note stays available because a doctor who
    // dictated "Dear Dr Singh" inside a progress note is not writing a letter.
    case 'dictated-letter':
      return [LETTER, NOTE]

    // Closing off an admission. The discharge summary leads; a note is still
    // offered because a doctor recapping a stay inside a progress note is not
    // necessarily discharging anybody today.
    case 'discharge':
      return [DISCHARGE, NOTE, ...FORM, RECORD]

    // A record being copied. The note is offered second and NOT first: writing
    // a note from a record produces a worse copy of a document that already
    // exists, which is the whole reason the paste classifier exists.
    //
    // The handover sheet sits here and nowhere else. Photographing a ward note
    // and printing a handover sheet from it are the two halves of one ward
    // round; on a dictated consultation there is no round to hand over.
    // The form comes AFTER the record here and before the sheet: a photographed
    // round is usually being filed, not re-typed onto the campus's own form —
    // the doctor is holding the paper it came from.
    case 'ward-note':
      return [RECORD, NOTE, ...FORM, HANDOVER]
  }
}

/**
 * Whether tapping this action writes over clinical data that already exists.
 *
 * The card marks these so a doctor moving fast can tell the difference between
 * "make me a document" and "change the record". A wrong note is discarded; a
 * wrong record write supersedes tracked fields — the fidelity contract's rule,
 * surfaced at the one moment it is actually being decided.
 */
export function isDestructive(a: SuggestedAction): boolean {
  return a.overwritesRecord === true
}
