import { describe, it, expect } from 'vitest'
import { inferWorkplaceType, WORKPLACE_TYPES } from '@/lib/workplaceType'

// A doctor who has typed "Albury Wodonga Health - Albury Campus" has already
// said it is a hospital. Asking again in the next field is asking twice.
//
// But a wrong guess is worse than no guess: the doctor must first NOTICE the
// field was answered wrongly before they can fix it, and a pre-filled field is
// exactly what people skip over. So null is the expected answer far more often
// than a type, and the tests below are mostly about NOT guessing.

describe('inferWorkplaceType — the confident cases', () => {
  it('reads a hospital by name', () => {
    expect(inferWorkplaceType('Royal Melbourne Hospital')).toBe('Hospital')
    expect(inferWorkplaceType('Albury Base Hospital')).toBe('Hospital')
  })

  it('reads an Australian health service as a hospital', () => {
    // The case that prompted this: the doctor's own workplace.
    expect(inferWorkplaceType('Albury Wodonga Health - Albury Campus')).toBe('Hospital')
    expect(inferWorkplaceType('Western Health')).toBe('Hospital')
    expect(inferWorkplaceType('Barwon Health Service')).toBe('Hospital')
  })

  it('reads community services', () => {
    expect(inferWorkplaceType('Wodonga Community Mental Health')).toBe('Community Mental Health')
    expect(inferWorkplaceType('Northern CMHT')).toBe('Community Mental Health')
    expect(inferWorkplaceType('headspace Albury')).toBe('Community Mental Health')
  })

  it('reads telehealth', () => {
    expect(inferWorkplaceType('Telehealth Psychiatry Australia')).toBe('Telehealth')
  })

  it('reads private practice', () => {
    expect(inferWorkplaceType('City Psychiatry Clinic')).toBe('Private Practice')
    expect(inferWorkplaceType('Hume Consulting Rooms')).toBe('Private Practice')
  })
})

describe('inferWorkplaceType — where order is load-bearing', () => {
  it('does not call a community mental health service a hospital', () => {
    // "Community Mental Health" contains "health", and an Australian hospital is
    // very often "<Place> Health" — so community must be tested first or every
    // CMHT reads as a hospital.
    expect(inferWorkplaceType('Albury Community Mental Health Service')).toBe('Community Mental Health')
  })

  it('does not call a telehealth practice a private practice', () => {
    expect(inferWorkplaceType('Telehealth Psychology Clinic')).toBe('Telehealth')
  })

  it('prefers hospital over practice when a name carries both', () => {
    // A hospital's psychiatry department is still a hospital.
    expect(inferWorkplaceType('Melbourne Hospital Psychiatry Unit')).toBe('Hospital')
  })
})

describe('inferWorkplaceType — refusing to guess', () => {
  it('returns null for a name that says nothing', () => {
    // The doctor picks. A pre-filled wrong answer is worse than an empty one.
    expect(inferWorkplaceType('Gaia Symbiosis')).toBeNull()
    expect(inferWorkplaceType('Lakeside')).toBeNull()
  })

  it('returns null for empty or near-empty input', () => {
    // Fires on every keystroke, so it must say nothing until there is something
    // to read — otherwise typing "Ho…" would flip the field on the third letter.
    expect(inferWorkplaceType('')).toBeNull()
    expect(inferWorkplaceType('  ')).toBeNull()
    expect(inferWorkplaceType('Ho')).toBeNull()
  })

  it('never returns a type that is not on the list', () => {
    const names = [
      'Royal Melbourne Hospital', 'Wodonga CMHT', 'Telehealth Australia',
      'City Psychiatry Clinic', 'Gaia Symbiosis', '',
    ]
    for (const n of names) {
      const out = inferWorkplaceType(n)
      if (out !== null) expect(WORKPLACE_TYPES).toContain(out)
    }
  })

  it('ignores case and stray spacing', () => {
    expect(inferWorkplaceType('  ROYAL   MELBOURNE   HOSPITAL  ')).toBe('Hospital')
  })
})
