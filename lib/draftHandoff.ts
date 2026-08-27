// What the doctor supplied between stopping a recording and the note appearing:
// the patient they named, and the template they picked.
//
// Until now this lived only in React context (hooks/useNoteStore), so a page
// load anywhere in that window discarded it silently — blank edit form, no
// generation, no error, and the session resurfacing as "Unnamed patient" with
// the name they had just typed nowhere. A reload there is not exotic: the App
// Router hard-navigates when a deployment's build id changes under an open tab,
// and EVERY promote changes the deployment, so shipping a release can do this to
// a doctor mid-note.
//
// The transcript was already durable in the recovery draft. This puts the rest
// of the handoff beside it, in the same document, so the step survives.
//
// Pure and parsed defensively for the same reason parseOnboardingDraft is: a
// handoff is read back by a possibly-newer build, and `undefined` reaching a
// controlled input turns it uncontrolled mid-note.

export interface DraftHandoff {
  patient: string
  reg_number: string
  session_number: string
  attendance: string
  dob: string
  gender: 'male' | 'female' | ''
  templateId: string | null
  templateTitle: string | null
  /** The doctor picked a template and expected a note — generation had begun. */
  pendingGeneration: boolean
}

export const EMPTY_HANDOFF: DraftHandoff = {
  patient: '',
  reg_number: '',
  session_number: '',
  attendance: '',
  dob: '',
  gender: '',
  templateId: null,
  templateTitle: null,
  pendingGeneration: false,
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

export function parseDraftHandoff(raw: unknown): DraftHandoff | null {
  // typeof [] is 'object', so an array would otherwise parse as a handoff of
  // empty strings — the same trap parseOnboardingDraft had to close.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const gender = str(r.gender)
  return {
    patient: str(r.patient),
    reg_number: str(r.reg_number),
    session_number: str(r.session_number),
    attendance: str(r.attendance),
    dob: str(r.dob),
    gender: gender === 'male' || gender === 'female' ? gender : '',
    templateId: nullableStr(r.templateId),
    templateTitle: nullableStr(r.templateTitle),
    pendingGeneration: r.pendingGeneration === true,
  }
}

/**
 * Whether this handoff is worth restoring. A patient name is the test: it is
 * what the doctor typed, what makes the note savable (autosave no-ops without
 * it) and what turns the amber Patients row from "Unnamed patient" into a
 * name. A handoff carrying only a template restores nothing a doctor would
 * notice, so it must not raise a recovery banner.
 */
export function handoffIsRestorable(h: DraftHandoff | null): boolean {
  return !!h && h.patient.trim().length > 0
}

/**
 * Find the template a handoff names, checking the doctor's own templates before
 * the built-ins — a custom template can carry a built-in's id as its base, and
 * the doctor's version is the one they picked.
 *
 * Ids are compared as strings because the built-in file uses numbers and custom
 * ones use 'custom_<timestamp>'; the handoff stores whatever it was as a string,
 * so `1 === '1'` has to hold here or every built-in would fail to resolve.
 *
 * Returns null when the template no longer exists. That is a real case — the
 * doctor may have deleted it between recording and reload — and it must not
 * block recovery, so the caller falls back to the picker.
 */
export function findTemplateById<T extends { id: string | number }>(
  id: string,
  builtins: T[],
  custom: T[] | undefined,
): T | null {
  const match = (t: T) => String(t.id) === id
  return (custom ?? []).find(match) ?? builtins.find(match) ?? null
}
