import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const source = readFileSync('components/modals/AddPatientModal.tsx', 'utf8')

describe('Add patient date of birth', () => {
  it('places the formatted DOB between UR number and Gender', () => {
    const ur = source.indexOf('htmlFor="ur-number"')
    const dob = source.indexOf('htmlFor="patient-dob"')
    const gender = source.indexOf('>Gender</label>')

    expect(ur).toBeGreaterThan(-1)
    expect(dob).toBeGreaterThan(ur)
    expect(gender).toBeGreaterThan(dob)
    expect(source).toContain('setDob(formatDob(e.target.value))')
  })

  it('blocks a submitted non-empty invalid DOB with the shared validation', () => {
    expect(source).toContain("if (dob.trim() && !dobCheck.valid) { setDobSubmitted(true); return }")
    expect(source).toContain('const dobCheck = validateDob(dob)')
    expect(source).toContain('shouldFlagDob(dob)')
    expect(source).toContain('{dobError && <p')
  })

  it('keeps the step-one DOB across every persistence path and clears it on close', () => {
    const savedDob = "...(dob.trim() ? { dob: dob.trim() } : {}),"
    expect(source).toContain(savedDob)
    expect(source.indexOf('...extra,')).toBeLessThan(source.indexOf(savedDob))
    expect(source).toContain('const saved = await persist({})')
    expect(source).toContain('const saved = await persist(fields, pasteText)')
    expect(source).toContain('const saved = await persist(fields, result.text)')
    expect(source).toContain("setDob('')")
  })
})
