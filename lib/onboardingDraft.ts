// What a doctor typed into onboarding before they walked away.
//
// Onboarding holds fifteen fields in React state and writes nothing until the
// final Get started. Someone who filled in four steps and closed the tab lost
// every keystroke — and then received an email three days later inviting them
// back to an empty form. The email made the loss worse: it asked them to do the
// work a second time without saying so.
//
// The draft lives on `users/{uid}.onboardingDraft` — the stub document that
// already exists by then — and is deleted the moment onboarding completes.
//
// Everything here is pure so the round-trip can be tested without Firestore.
// A draft is read back long after it was written, sometimes by a newer version
// of the app, so `parseOnboardingDraft` treats every field as untrusted: a
// missing, renamed or wrong-typed value falls back to the same default a fresh
// form would show, rather than putting `undefined` into a controlled input.

import type { WorkplaceType } from '@/types'

export const ONBOARDING_STEPS = 6
export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6

export interface OnboardingDraft {
  step: OnboardingStep
  displayName: string
  credentials: string
  position: string
  providerNumber: string
  workPhone: string
  workplaceName: string
  workplaceType: WorkplaceType
  regSystem: 'none' | 'existing'
  regFormat: string
  selectedPreset: 0 | 1 | 2 | 3
  emailPretext: string
  geminiApiKey: string
  groqApiKey: string
  signatureUrl: string | null
  marketingConsent: boolean
  savedAt: number
}

const WORKPLACE_TYPES: WorkplaceType[] = [
  'Private Practice', 'Hospital', 'Community Mental Health', 'Telehealth', 'Other',
]

function str(v: unknown, max = 1000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/**
 * Read a stored draft back into form values.
 *
 * Never throws and never returns undefined for a field. A half-written or
 * outdated draft degrades to a partly-filled form, which is still better than
 * the empty one the doctor would otherwise face.
 */
export function parseOnboardingDraft(raw: unknown): OnboardingDraft | null {
  // Arrays are objects too, and a corrupt read that hands back [] must not
  // become a draft of empty strings that looks like real saved progress.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>

  const step = typeof d.step === 'number' && d.step >= 1 && d.step <= ONBOARDING_STEPS
    ? (Math.floor(d.step) as OnboardingStep)
    : 1
  const preset = typeof d.selectedPreset === 'number' && d.selectedPreset >= 0 && d.selectedPreset <= 3
    ? (Math.floor(d.selectedPreset) as 0 | 1 | 2 | 3)
    : 0
  const workplaceType = WORKPLACE_TYPES.includes(d.workplaceType as WorkplaceType)
    ? (d.workplaceType as WorkplaceType)
    : 'Private Practice'

  return {
    step,
    displayName: str(d.displayName, 200),
    credentials: str(d.credentials, 200),
    position: str(d.position, 200),
    providerNumber: str(d.providerNumber, 100),
    workPhone: str(d.workPhone, 100),
    workplaceName: str(d.workplaceName, 200),
    workplaceType,
    regSystem: d.regSystem === 'existing' ? 'existing' : 'none',
    regFormat: str(d.regFormat, 100),
    selectedPreset: preset,
    emailPretext: str(d.emailPretext, 1000),
    geminiApiKey: str(d.geminiApiKey, 200),
    groqApiKey: str(d.groqApiKey, 200),
    signatureUrl: typeof d.signatureUrl === 'string' && d.signatureUrl ? d.signatureUrl : null,
    marketingConsent: d.marketingConsent === true,
    savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
  }
}

/**
 * Has the doctor actually entered anything worth coming back to?
 *
 * Landing on step one and closing the tab must not leave a draft — it would
 * make the resume banner appear for someone who has nothing to resume, and
 * spend a Firestore write per visitor who bounces. The step number alone does
 * not count as progress; only typed content does.
 */
export function draftHasContent(draft: Partial<OnboardingDraft>): boolean {
  return !!(
    draft.displayName?.trim() ||
    draft.credentials?.trim() ||
    draft.position?.trim() ||
    draft.providerNumber?.trim() ||
    draft.workPhone?.trim() ||
    draft.workplaceName?.trim() ||
    draft.regFormat?.trim() ||
    draft.geminiApiKey?.trim() ||
    draft.groqApiKey?.trim() ||
    draft.signatureUrl
  )
}

/**
 * Where to put the doctor back.
 *
 * Never past the last step they can act on, and never at the review pane on a
 * draft that could not pass it — returning someone to a screen whose button is
 * disabled reads as the app being broken. Name and workplace are the only hard
 * requirements, so those are what the resume point is checked against.
 */
export function resumeStep(draft: OnboardingDraft): OnboardingStep {
  if (!draft.displayName.trim()) return 1
  if (!draft.workplaceName.trim()) return 2
  return draft.step
}
