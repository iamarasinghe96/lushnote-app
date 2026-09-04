import { describe, it, expect } from 'vitest'
import { countListItems, tidyPreservesStructure } from '@/lib/tidyGuard'

// Written from a real failure, 2026-09-04. Tidying a ward-round note handled
// every fidelity trap put to it — an unexpanded IDC, a "?delirium" hedge, a
// triple negative in a risk line, doses, "declined" not "refused" — and then
// merged a sub-item into its parent. Four plan steps in, three out. The prompt
// had already asked for the structure to be kept.

const PLAN = `plan:
1. continue quetiapine
  1a. cease if delirium settles
2. TWOC am
3. rpt bloods fri`

const MERGED = `Plan:
1. Continue quetiapine, with cessation if delirium resolves.
2. Perform TWOC in the morning.
3. Repeat blood tests on Friday.`

describe('countListItems', () => {
  it('counts a sub-item as an item of its own', () => {
    // The whole point: a counter that folded 1a. into 1. could not see the
    // failure this exists to catch.
    expect(countListItems(PLAN)).toBe(4)
  })

  it('counts what the model actually returned', () => {
    expect(countListItems(MERGED)).toBe(3)
  })

  it('recognises the markers a doctor actually types', () => {
    expect(countListItems('1. one\n2) two\na. three\nii. four\n- five\n• six\n* seven')).toBe(7)
  })

  it('ignores prose that merely starts with a number', () => {
    // "78yo man, day 4 post op." must not read as a list item.
    expect(countListItems('78yo man, day 4 post op.\nObs stable, afebrile.')).toBe(0)
  })

  it('ignores a bare marker with nothing after it', () => {
    expect(countListItems('1.\n2.')).toBe(0)
  })

  it('is unbothered by indentation', () => {
    expect(countListItems('   1. one\n      1a. sub')).toBe(2)
  })
})

describe('tidyPreservesStructure', () => {
  it('refuses the exact rewrite that merged the plan', () => {
    const check = tidyPreservesStructure(PLAN, MERGED)
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('4 items into 3')
  })

  it('accepts a rewrite that kept every item', () => {
    const kept = `Plan:
1. Continue quetiapine.
  1a. Cease if the delirium settles.
2. TWOC in the morning.
3. Repeat bloods on Friday.`
    expect(tidyPreservesStructure(PLAN, kept).ok).toBe(true)
  })

  it('refuses a rewrite that INVENTED a plan item', () => {
    const padded = PLAN + '\n4. Refer to geriatrics.'
    expect(tidyPreservesStructure(PLAN, padded).ok).toBe(false)
  })

  it('leaves prose alone — there is no structure to lose', () => {
    // Sample 1 and 3 from the real test: no list, and reflowing sentences is
    // exactly what the button is for. Judging wording would refuse every
    // successful rewrite.
    const before = 'pt seen on ward round. mood ok ish. no thoughts of self harm today.'
    const after = 'The patient was seen on the ward round. He reports his mood as "okay-ish". He denies any thoughts of self-harm today.'
    expect(tidyPreservesStructure(before, after).ok).toBe(true)
  })

  it('says what would have been lost, not just that it refused', () => {
    const check = tidyPreservesStructure('1. a\n2. b\n3. c', '1. a and b\n2. c')
    expect(check.reason).toContain('3 items into 2')
    expect(check.reason).toContain('unchanged')
  })
})
