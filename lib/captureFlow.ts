import type { ActionKey } from './suggestedActions'
import type { CaptureIntent } from './captureIntent'

// The decisions the capture card makes on the doctor's behalf.
//
// Stage 3 gave the FAB a Record and a Capture button. This is what happens
// after one of them finishes: the steps a doctor used to walk through — name
// the patient, choose a template — run unattended, and the card presents the
// result as one tap.
//
// That only works if the tap is still a real confirmation, which puts two
// requirements on this file. Everything the tap is about to do must be VISIBLE
// on the card (which patient, which template), and the one action that writes
// over an existing record must be refusable when we do not know enough to do it
// safely. Both are decisions, not rendering, so they live here and are tested.

/** Comprehensive Psychology Note — the app's default, and already what
 *  "Start a psychiatrist note" means on the dictate pathway. */
export const DEFAULT_TEMPLATE_ID = '1'

/** "Discharge Summary - Letter to Referrer". It has been among the 116 all
 *  along; what the discharge action adds is reaching it without hunting. */
export const DISCHARGE_TEMPLATE_ID = '40'

export type TemplateReason = 'recent' | 'default'

export interface TemplateChoice {
  id: string
  reason: TemplateReason
}

/** Said on the card, next to the template's title. A doctor cannot confirm a
 *  choice they cannot see, so the card never generates without showing both
 *  which template and why it was picked. */
export const TEMPLATE_REASON_LABEL: Record<TemplateReason, string> = {
  recent: 'last used',
  default: 'your default',
}

/**
 * Which template a one-tap note generates with.
 *
 * **The doctor's own last choice, not a rule about intent.** It was tempting to
 * map each intent to a template — a consultation to one, a dictation to another
 * — but `CLAUDE.md` already records why that is wrong for a recording: a
 * recorded consultation could legitimately be any template, and nothing about
 * pressing Record says which. Their most recent choice is the one piece of
 * evidence that is actually about THIS doctor, and the card shows it with a way
 * to change it, so a wrong guess costs one tap instead of being imposed.
 *
 * `recentIds` is `localStorage('lnTemplateUsage')`, most recent first.
 */
export function pickCaptureTemplate(recentIds: readonly (string | number)[]): TemplateChoice {
  const first = recentIds.map(String).find(id => id.trim() !== '')
  if (first === undefined) return { id: DEFAULT_TEMPLATE_ID, reason: 'default' }
  return { id: first, reason: first === DEFAULT_TEMPLATE_ID ? 'default' : 'recent' }
}

export interface CaptureReview {
  /** What was captured. Empty means the capture produced nothing. */
  transcript: string
  /** The name on the card — extracted, then edited by the doctor. */
  patientName: string
}

/**
 * Why an action cannot run yet, or null when it can.
 *
 * **The record write is the one that must be refusable.** A note generated for
 * the wrong patient is discarded; a record write with no name either invents a
 * profile or merges this capture into whichever profile matches an empty string
 * — and per the fidelity contract a later entry SUPERSEDES tracked fields, so
 * that is somebody else's record being overwritten. The card disables it rather
 * than trusting the tap.
 *
 * A note, a letter and the escape hatch all stay available unnamed: the edit
 * page already carries an unnamed note and its autosave no-ops until a patient
 * is named, so nothing is written anywhere until the doctor supplies one.
 *
 * Gated on the ACTION WRITING a record, not on its key, so an action added later
 * cannot slip past by not being one of the two names listed here.
 */
export function actionBlocker(key: ActionKey, r: CaptureReview): string | null {
  if (!r.transcript.trim()) return 'Nothing was captured'
  if (WRITES_RECORD.has(key) && !r.patientName.trim()) return 'Add the name first'
  return null
}

/** Every action whose first act is to write the patient's tracked record. */
const WRITES_RECORD: ReadonlySet<ActionKey> = new Set<ActionKey>(['patient-record', 'patient-pdf'])

/**
 * Does this patient already have a tracked profile?
 *
 * **The card must not create a second one.** `savePatientProfile` with no `id`
 * calls `addDoc`, so "create the profile" for somebody who already has one does
 * not update them — it adds a second card holding a name, a DOB and nothing
 * else, and splits their record across the two. The naming step gates the same
 * write on `isNewPatient`; the card, which replaced that step, inherits the
 * rule.
 *
 * Case- and whitespace-insensitive, because "mrs patel " and "Mrs Patel" are
 * one person and a transcript is where that difference comes from.
 */
export function isTrackedPatient(name: string, profiles: readonly { displayName: string }[]): boolean {
  const needle = name.trim().toLowerCase()
  if (!needle) return false
  return profiles.some(p => p.displayName.trim().toLowerCase() === needle)
}

/** How the card names what it read. Kept beside the classifier's intents so a
 *  new intent cannot be added without deciding what a doctor is shown. */
export const INTENT_LABEL: Record<CaptureIntent, string> = {
  'consultation': 'a consultation',
  'dictated-note': 'a dictated note',
  'dictated-letter': 'a letter',
  'discharge': 'a discharge summary',
  'ward-note': 'a ward note',
}

/**
 * A short, single-line excerpt for the card.
 *
 * The doctor has to be able to tell at a glance that this is the recording they
 * think it is — the capture ran unattended, so the card is the first sight they
 * get of it. Cut on a word boundary; a hard slice mid-word reads as corruption.
 */
export function captureExcerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}
