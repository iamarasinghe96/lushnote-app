import { describe, it, expect } from 'vitest'
import {
  reconcileRefinedSections,
  refinementChangedAnything,
  type SentSection,
} from '@/lib/letterTemplateRefine'

// Refinement is cosmetic — it fixes spelling in topics a doctor typed. The
// template it produces is then used for every letter of that type, so a topic
// quietly dropped or reworded here is wrong in every letter afterwards, under
// the doctor's own title. Everything below exists because the system prompt
// ASKED for these properties and nothing checked them.

const sent = (...rows: Array<[string, string, boolean]>): SentSection[] =>
  rows.map(([heading, description, refine]) => ({ heading, description, refine }))

describe('reconcileRefinedSections', () => {
  it('takes the cleaned-up wording when the shape is intact', () => {
    const out = reconcileRefinedSections(
      sent(['diagnossis', 'the dx', true], ['plan', 'wat next', true]),
      [{ heading: 'Diagnosis', description: 'The diagnosis' },
       { heading: 'Plan', description: 'What happens next' }],
    )
    expect(out).toEqual([
      { heading: 'Diagnosis', description: 'The diagnosis' },
      { heading: 'Plan', description: 'What happens next' },
    ])
  })

  it('rejects a refinement that DROPPED a topic', () => {
    // The failure this was written for: eight topics in, six back, saved
    // silently. There is no safe mapping, so the whole refinement goes.
    const out = reconcileRefinedSections(
      sent(['Diagnosis', '', true], ['Medications', '', true], ['Plan', '', true]),
      [{ heading: 'Diagnosis', description: '' }, { heading: 'Plan', description: '' }],
    )
    expect(out).toBeNull()
  })

  it('rejects a refinement that ADDED a topic', () => {
    const out = reconcileRefinedSections(
      sent(['Diagnosis', '', true]),
      [{ heading: 'Diagnosis', description: '' }, { heading: 'Prognosis', description: '' }],
    )
    expect(out).toBeNull()
  })

  it('rejects a refinement that MERGED two topics', () => {
    const out = reconcileRefinedSections(
      sent(['History', '', true], ['Medications', '', true]),
      [{ heading: 'History and Medications', description: '' }],
    )
    expect(out).toBeNull()
  })

  it('restores a KEEP EXACTLY topic the model reworded anyway', () => {
    // The instruction to leave it alone is a request. This is what makes it a
    // guarantee — a doctor editing a template left this topic alone on purpose.
    const out = reconcileRefinedSections(
      sent(['Pt goals (own words)', 'verbatim pls', false], ['plan', '', true]),
      [{ heading: 'Patient Goals', description: 'Verbatim, please' },
       { heading: 'Plan', description: '' }],
    )
    expect(out![0]).toEqual({ heading: 'Pt goals (own words)', description: 'verbatim pls' })
    expect(out![1].heading).toBe('Plan')
  })

  it('keeps the original heading when the model returns an empty one', () => {
    // An emptied heading is a dropped topic in disguise — the count still
    // matches, so the length check alone would let it through.
    const out = reconcileRefinedSections(
      sent(['Medications', 'current meds', true]),
      [{ heading: '   ', description: 'Current medications' }],
    )
    expect(out![0].heading).toBe('Medications')
    expect(out![0].description).toBe('Current medications')
  })

  it('allows a description to be emptied', () => {
    // Descriptions are optional and a refiner may fold one into the heading.
    // Only the heading is load-bearing.
    const out = reconcileRefinedSections(
      sent(['Diagnosis', 'the dx', true]),
      [{ heading: 'Primary Diagnosis', description: '' }],
    )
    expect(out![0]).toEqual({ heading: 'Primary Diagnosis', description: '' })
  })

  it('matches positionally, never by heading', () => {
    // Headings are the thing refinement is asked to change, so they cannot be
    // the key. Matching by heading here would pair nothing and lose both.
    const out = reconcileRefinedSections(
      sent(['dx', '', true], ['mx', '', true]),
      [{ heading: 'Diagnosis', description: '' }, { heading: 'Management', description: '' }],
    )
    expect(out).toEqual([
      { heading: 'Diagnosis', description: '' },
      { heading: 'Management', description: '' },
    ])
  })

  it('preserves order rather than sorting', () => {
    const out = reconcileRefinedSections(
      sent(['Plan', '', true], ['Diagnosis', '', true]),
      [{ heading: 'Plan', description: '' }, { heading: 'Diagnosis', description: '' }],
    )
    expect(out!.map(s => s.heading)).toEqual(['Plan', 'Diagnosis'])
  })

  it('returns null for no topics at all', () => {
    expect(reconcileRefinedSections([], [])).toBeNull()
  })

  it('handles a template that is entirely locked', () => {
    // Editing a template and changing only the title: every topic comes back
    // exactly as typed, whatever the model did.
    const rows = sent(['One', 'a', false], ['Two', 'b', false])
    const out = reconcileRefinedSections(rows, [
      { heading: 'Uno', description: 'A' }, { heading: 'Dos', description: 'B' },
    ])
    expect(out).toEqual([
      { heading: 'One', description: 'a' },
      { heading: 'Two', description: 'b' },
    ])
  })
})

describe('refinementChangedAnything', () => {
  it('is false when the refiner returned the input verbatim', () => {
    const rows = sent(['Diagnosis', 'the dx', true])
    const out = reconcileRefinedSections(rows, [{ heading: 'Diagnosis', description: 'the dx' }])
    expect(refinementChangedAnything(rows, out!)).toBe(false)
  })

  it('is true when wording was cleaned up', () => {
    const rows = sent(['diagnossis', 'the dx', true])
    const out = reconcileRefinedSections(rows, [{ heading: 'Diagnosis', description: 'The diagnosis' }])
    expect(refinementChangedAnything(rows, out!)).toBe(true)
  })
})
