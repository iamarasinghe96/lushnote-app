import { describe, it, expect } from 'vitest'
import { planTidy, applyTidy, type TidyTarget } from '@/lib/tidyTargets'

// A letter is several fields. One button covers all of them, in one request, and
// must still touch only what the doctor changed — with a reply that either
// splices back completely or is discarded completely. A per-field request would
// half-succeed: some paragraphs tidied, some not, no way back to a consistent
// document.

function target(key: string, value: string, baseline: string | null): TidyTarget {
  return { key, value, baseline, onChange: () => {} }
}

describe('planTidy', () => {
  it('gathers changed lines across fields, in field order', () => {
    const targets = [
      target('a', 'generated line\ndoctor added one', 'generated line'),
      target('b', 'also generated\nand two', 'also generated'),
    ]
    const plan = planTidy(targets)
    expect(plan.lines.map(l => l.text)).toEqual(['doctor added one', 'and two'])
    expect(plan.lines.map(l => l.key)).toEqual(['a', 'b'])
  })

  it('sends nothing generated', () => {
    const plan = planTidy([target('a', 'generated line\nnew', 'generated line')])
    expect(plan.payload).toBe('new')
    expect(plan.payload).not.toContain('generated')
  })

  it('is empty when the doctor has changed nothing', () => {
    expect(planTidy([target('a', 'same', 'same')]).lines).toHaveLength(0)
  })

  it('treats a field with no baseline as all the doctor’s', () => {
    expect(planTidy([target('a', 'one\ntwo', null)]).lines).toHaveLength(2)
  })
})

describe('applyTidy', () => {
  const targets = [
    target('a', 'generated line\ndoctor added one', 'generated line'),
    target('b', 'also generated\nand two', 'also generated'),
  ]
  const plan = planTidy(targets)

  it('routes each reply back to the field it came from', () => {
    const out = applyTidy(targets, plan, 'The doctor added one.\nAnd two.')!
    expect(out.updates.a).toBe('generated line\nThe doctor added one.')
    expect(out.updates.b).toBe('also generated\nAnd two.')
  })

  it('never lets one field’s prose land in another', () => {
    const out = applyTidy(targets, plan, 'The doctor added one.\nAnd two.')!
    expect(out.updates.a).not.toContain('two')
    expect(out.updates.b).not.toContain('doctor added one')
  })

  it('refuses the whole reply when the line count is wrong', () => {
    // Discarded completely rather than applied partially — a letter with two of
    // three paragraphs tidied has no way back to a consistent state.
    expect(applyTidy(targets, plan, 'only one line')).toBeNull()
    expect(applyTidy(targets, plan, 'one\ntwo\nthree')).toBeNull()
  })

  it('reports only the fields that actually changed', () => {
    // A reply identical to the input must not mark the field dirty, or Undo
    // would offer to restore something that never moved.
    const same = [target('a', 'x\ny', 'x')]
    const p = planTidy(same)
    const out = applyTidy(same, p, 'y')!
    expect(out.updates).toEqual({})
  })

  it('leaves generated prose byte-identical', () => {
    const out = applyTidy(targets, plan, 'The doctor added one.\nAnd two.')!
    expect(out.updates.a.startsWith('generated line\n')).toBe(true)
    expect(out.updates.b.startsWith('also generated\n')).toBe(true)
  })
})
