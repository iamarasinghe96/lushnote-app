import { describe, it, expect } from 'vitest'
import { validateDob, shouldFlagDob } from '@/lib/dobValidation'

// A DOB identifies a patient and reaches letters, hospital forms and the patient
// record. Nothing validated it before, so 45/45/9999 and 31/02/1990 both saved.
// The bar for an error is "the app can KNOW this is wrong" — an unusual but
// possible date is a real patient somewhere.

const NOW = new Date(2026, 7, 28) // 28 Aug 2026, fixed so the future rule is testable

describe('validateDob', () => {
  it('accepts an ordinary date of birth', () => {
    expect(validateDob('12/12/1965', NOW).valid).toBe(true)
  })

  it('accepts empty — DOB is optional', () => {
    // Colouring an untouched field red is how a form nags before it is used.
    expect(validateDob('', NOW).valid).toBe(true)
    expect(validateDob('   ', NOW).valid).toBe(true)
  })

  it('rejects the nonsense the mask used to allow', () => {
    expect(validateDob('45/45/9999', NOW).valid).toBe(false)
    expect(validateDob('00/01/1990', NOW).valid).toBe(false)
    expect(validateDob('01/00/1990', NOW).valid).toBe(false)
    expect(validateDob('01/13/1990', NOW).valid).toBe(false)
  })

  it('rejects a day that month does not have', () => {
    expect(validateDob('31/04/1990', NOW).valid).toBe(false)
    expect(validateDob('31/06/1990', NOW).valid).toBe(false)
    expect(validateDob('30/02/1990', NOW).valid).toBe(false)
  })

  it('knows its leap years', () => {
    // 29 Feb is a real birthday. Rejecting it would tell a real patient their
    // own date of birth is invalid.
    expect(validateDob('29/02/2000', NOW).valid).toBe(true)  // /400 → leap
    expect(validateDob('29/02/2024', NOW).valid).toBe(true)  // /4   → leap
    expect(validateDob('29/02/1900', NOW).valid).toBe(false) // /100 → not leap
    expect(validateDob('29/02/2023', NOW).valid).toBe(false)
  })

  it('says WHY a leap day was refused', () => {
    expect(validateDob('29/02/2023', NOW).error).toBe('2023 is not a leap year')
  })

  it('rejects a future date of birth', () => {
    expect(validateDob('29/08/2026', NOW).valid).toBe(false)
    expect(validateDob('01/01/2030', NOW).valid).toBe(false)
  })

  it('accepts a patient born today', () => {
    // Compared as whole days — the hours since midnight must not make a
    // newborn's DOB "in the future".
    expect(validateDob('28/08/2026', NOW).valid).toBe(true)
  })

  it('accepts the very old without arguing', () => {
    // 104 is unusual and real. The app must not tell a doctor their patient
    // cannot exist.
    expect(validateDob('01/01/1922', NOW).valid).toBe(true)
  })

  it('rejects a year that can only be a typo', () => {
    expect(validateDob('01/01/1850', NOW).valid).toBe(false)
    expect(validateDob('01/01/0190', NOW).valid).toBe(false)
  })

  it('rejects a shape that is not DD/MM/YYYY', () => {
    expect(validateDob('1/1/1990', NOW).valid).toBe(false)
    expect(validateDob('1990-01-01', NOW).valid).toBe(false)
    expect(validateDob('12/12/65', NOW).valid).toBe(false)
  })
})

describe('shouldFlagDob', () => {
  it('stays quiet while the doctor is still typing', () => {
    // The mask feeds digits in one at a time. Red on "1" is noise, and a field
    // that goes red before it can be right trains people to ignore red.
    for (const partial of ['', '1', '12', '12/1', '12/12', '12/12/1', '12/12/196']) {
      expect(shouldFlagDob(partial, NOW)).toBe(false)
    }
  })

  it('flags a complete date that is wrong', () => {
    expect(shouldFlagDob('45/45/9999', NOW)).toBe(true)
    expect(shouldFlagDob('31/02/1990', NOW)).toBe(true)
    expect(shouldFlagDob('01/01/2030', NOW)).toBe(true)
  })

  it('does not flag a complete date that is right', () => {
    expect(shouldFlagDob('12/12/1965', NOW)).toBe(false)
    expect(shouldFlagDob('29/02/2024', NOW)).toBe(false)
  })
})
