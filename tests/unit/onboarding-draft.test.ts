import { describe, it, expect } from 'vitest'
import {
  parseOnboardingDraft, draftHasContent, resumeStep,
  type OnboardingDraft,
} from '@/lib/onboardingDraft'

// A draft is written by one version of the app and read back days later,
// possibly by a newer one. Every field here is untrusted on the way in: putting
// `undefined` into a controlled input turns it uncontrolled and React starts
// warning, and a doctor returning from an abandonment email deserves better
// than a form that half-works.

const FULL = {
  step: 4, displayName: 'Dr Test', credentials: 'FRANZCP', position: 'Consultant',
  providerNumber: '2345678B', workPhone: '(02) 6058 4444', workplaceName: 'City Clinic',
  workplaceType: 'Hospital', regSystem: 'existing', regFormat: '12345678AB',
  selectedPreset: 2, emailPretext: 'Please find enclosed.',
  geminiApiKey: 'AIzaFake', groqApiKey: 'gsk_fake', signatureUrl: 'https://x/sig.svg',
  marketingConsent: true, savedAt: 1_700_000_000_000,
}

describe('parseOnboardingDraft', () => {
  it('round-trips a complete draft', () => {
    expect(parseOnboardingDraft(FULL)).toEqual(FULL)
  })

  it('returns null for nothing to restore', () => {
    for (const v of [null, undefined, '', 0, [], 'a string']) {
      expect(parseOnboardingDraft(v as unknown)).toBe(null)
    }
  })

  it('gives every field a usable default when the draft is empty', () => {
    // The failure this prevents: undefined reaching a controlled input, which
    // makes React switch it to uncontrolled and log a warning mid-signup.
    const d = parseOnboardingDraft({})!
    expect(d.displayName).toBe('')
    expect(d.workplaceType).toBe('Private Practice')
    expect(d.regSystem).toBe('none')
    expect(d.selectedPreset).toBe(0)
    expect(d.step).toBe(1)
    expect(d.signatureUrl).toBe(null)
    expect(d.marketingConsent).toBe(false)
    for (const value of Object.values(d)) expect(value).not.toBe(undefined)
  })

  it('rejects a workplace type that is not one of the offered options', () => {
    // A renamed or removed option must not survive into the select.
    expect(parseOnboardingDraft({ ...FULL, workplaceType: 'Spaceship' })!.workplaceType)
      .toBe('Private Practice')
  })

  it('clamps a step outside the six that exist', () => {
    for (const step of [0, -3, 7, 99, 2.7, 'four', null]) {
      const d = parseOnboardingDraft({ ...FULL, step })!
      expect(d.step).toBeGreaterThanOrEqual(1)
      expect(d.step).toBeLessThanOrEqual(6)
    }
  })

  it('coerces wrong types rather than passing them through', () => {
    const d = parseOnboardingDraft({
      displayName: 42, credentials: null, marketingConsent: 'yes',
      regSystem: 'nonsense', signatureUrl: 123,
    })!
    expect(d.displayName).toBe('')
    expect(d.credentials).toBe('')
    expect(d.marketingConsent).toBe(false)   // only a real true counts
    expect(d.regSystem).toBe('none')
    expect(d.signatureUrl).toBe(null)
  })

  it('truncates absurdly long values instead of storing them', () => {
    const d = parseOnboardingDraft({ displayName: 'x'.repeat(5000) })!
    expect(d.displayName.length).toBe(200)
  })
})

describe('draftHasContent', () => {
  it('is false for a doctor who opened onboarding and left immediately', () => {
    // No draft should be written for a bounce: it would show a resume banner to
    // someone with nothing to resume, and cost a write per visitor.
    expect(draftHasContent(parseOnboardingDraft({})!)).toBe(false)
  })

  it('is false when only the step advanced', () => {
    expect(draftHasContent(parseOnboardingDraft({ step: 5 })!)).toBe(false)
  })

  it('is false for whitespace typed and deleted', () => {
    expect(draftHasContent(parseOnboardingDraft({ displayName: '   ' })!)).toBe(false)
  })

  it.each([
    ['displayName', 'Dr Test'],
    ['workplaceName', 'City Clinic'],
    ['providerNumber', '2345678B'],
    ['geminiApiKey', 'AIzaFake'],
    ['signatureUrl', 'https://x/sig.svg'],
  ])('is true once %s has been entered', (field, value) => {
    expect(draftHasContent(parseOnboardingDraft({ [field]: value })!)).toBe(true)
  })
})

describe('resumeStep', () => {
  const draft = (over: Partial<OnboardingDraft>) =>
    parseOnboardingDraft({ ...FULL, ...over })!

  it('returns to the step the doctor was on', () => {
    expect(resumeStep(draft({ step: 5 }))).toBe(5)
  })

  it('sends them back to step 1 when the name is missing', () => {
    // Every later step is reachable without a name only if the draft is
    // corrupt. Resuming past it would strand them on a disabled Continue.
    expect(resumeStep(draft({ step: 6, displayName: '' }))).toBe(1)
  })

  it('sends them back to step 2 when the workplace is missing', () => {
    expect(resumeStep(draft({ step: 6, workplaceName: '' }))).toBe(2)
  })

  it('never returns a step the doctor cannot act on', () => {
    for (const step of [1, 2, 3, 4, 5, 6] as const) {
      const s = resumeStep(draft({ step }))
      expect(s).toBeGreaterThanOrEqual(1)
      expect(s).toBeLessThanOrEqual(6)
    }
  })
})
