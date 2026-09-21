import { describe, expect, it } from 'vitest'
import { checkRegStatus } from '@/lib/regNumber'
import type { Workplace } from '@/types'

// The hospital in the report uses ########AA - eight digits then two letters.
const AWH = {
  id: 'w1', name: 'Albury Wodonga Health', type: 'Hospital', themeIndex: 0,
  regSystem: 'existing', regPattern: '^\\d{8}[A-Za-z]{2}$', regTemplate: '########AA',
} as Workplace

describe('checkRegStatus', () => {
  it('accepts a number in the hospital format', () => {
    expect(checkRegStatus('12345678AB', AWH)).toBe('valid')
  })

  // The number from the report: seven digits, no letters.
  it('rejects the number that was being shown as fine', () => {
    expect(checkRegStatus('1234565', AWH)).toBe('invalid')
  })

  it('rejects a number that is close but not right', () => {
    expect(checkRegStatus('12345678A', AWH)).toBe('invalid')
    expect(checkRegStatus('12345678ABC', AWH)).toBe('invalid')
  })

  // Three innocent cases that must all stay silent.
  it('has no opinion about an empty field', () => {
    expect(checkRegStatus('', AWH)).toBe('none')
  })

  it('has no opinion when the workplace does not use registration numbers', () => {
    expect(checkRegStatus('anything', { ...AWH, regSystem: 'none' } as Workplace)).toBe('none')
    expect(checkRegStatus('anything', { ...AWH, regPattern: undefined } as Workplace)).toBe('none')
    expect(checkRegStatus('anything', undefined)).toBe('none')
  })

  // Our pattern, our problem: it is generated from what a doctor typed during
  // onboarding, and a broken one must not become their error - or a crash.
  it('has no opinion when our own pattern will not compile', () => {
    const broken = { ...AWH, regPattern: '^\\d{8}[A-Za-z' } as Workplace
    expect(() => checkRegStatus('12345678AB', broken)).not.toThrow()
    expect(checkRegStatus('12345678AB', broken)).toBe('none')
  })
})
