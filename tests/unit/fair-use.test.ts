import { describe, expect, it } from 'vitest'
import {
  FAIR_USE_ALLOWANCE_MICROS, FAIR_USE_WARN_SHARE, NET_REVENUE_MICROS, PAYMENT_FEE_SHARE, PLAN_PRICE_AUD,
  allowanceResetsOn, fairUseLevel, fairUseOf, isEnterprise, paidSpend,
} from '@/lib/fairUse'
import { USD_TO_AUD } from '@/lib/aiCost'
import type { User } from '@/types'

// Fair use decides when an account stops being served on LushNote's paid key.
// Wrong in one direction and a practice sharing one login runs up a bill the
// rest of the subscriptions pay for; wrong in the other and a doctor doing
// ordinary work is told they have used more than their share. Every test here
// is one of those two mistakes.

type Billing = NonNullable<User['billing']>
const MONTH = '2026-09'
const ENTERPRISE = { enterprise: { since: 1, tosVersion: 'v', by: 'doctor' } } as unknown as Billing

describe('the allowance', () => {
  // The owner's rule: past break-even. Never above what the subscription
  // actually brings in, or the allowance itself is the loss.
  it('never exceeds what the subscription nets', () => {
    const grossMicros = (PLAN_PRICE_AUD / USD_TO_AUD) * 1_000_000
    expect(FAIR_USE_ALLOWANCE_MICROS).toBeLessThanOrEqual(grossMicros)
    expect(FAIR_USE_ALLOWANCE_MICROS).toBe(NET_REVENUE_MICROS)
  })

  it('takes the payment fees off before it is spent on AI', () => {
    expect(PAYMENT_FEE_SHARE).toBeGreaterThan(0)
    expect(NET_REVENUE_MICROS).toBe(Math.round((PLAN_PRICE_AUD / USD_TO_AUD) * (1 - PAYMENT_FEE_SHARE) * 1_000_000))
  })

  // The order of magnitude the rest of the codebase was written against.
  it('is roughly USD $18.70 a month', () => {
    expect(FAIR_USE_ALLOWANCE_MICROS).toBeGreaterThan(18_000_000)
    expect(FAIR_USE_ALLOWANCE_MICROS).toBeLessThan(19_500_000)
  })

  // Integer micro-USD, like every other figure in the meter.
  it('is a whole number of micro-dollars', () => {
    expect(Number.isInteger(FAIR_USE_ALLOWANCE_MICROS)).toBe(true)
  })
})

describe('what counts towards it', () => {
  // Only OUR keys. A doctor's own free key costs LushNote nothing, and months
  // recorded before the split carried the doctor's own calls in `micros`.
  it('counts the paid share only, never the total', () => {
    expect(paidSpend({ micros: 50_000_000, paid: 1_000 })).toBe(1_000)
  })

  it('reads a month recorded before the split as nothing of ours', () => {
    expect(paidSpend({ micros: 50_000_000 })).toBe(0)
    expect(paidSpend(undefined)).toBe(0)
  })

  it('ignores a value that is not a real spend', () => {
    expect(paidSpend({ paid: Number.NaN })).toBe(0)
    expect(paidSpend({ paid: -5 })).toBe(0)
  })
})

describe('levels', () => {
  it('is within until the warning share', () => {
    expect(fairUseLevel(0, 100)).toBe('within')
    expect(fairUseLevel(100 * FAIR_USE_WARN_SHARE - 1, 100)).toBe('within')
  })

  it('warns before the switch, not in the same breath', () => {
    expect(fairUseLevel(100 * FAIR_USE_WARN_SHARE, 100)).toBe('approaching')
    expect(fairUseLevel(99, 100)).toBe('approaching')
  })

  // Same edge resolveAiKeys switches on: at the allowance, not past it.
  it('is exceeded at the allowance itself', () => {
    expect(fairUseLevel(100, 100)).toBe('exceeded')
    expect(fairUseLevel(101, 100)).toBe('exceeded')
  })

  it('treats no allowance as nothing to exceed', () => {
    expect(fairUseLevel(999, 0)).toBe('within')
  })
})

describe('an account this month', () => {
  it('measures the month asked for, not the latest one on record', () => {
    const f = fairUseOf({
      aiCost: { '2026-08': { paid: 999_000_000 }, [MONTH]: { paid: 10, micros: 40 } },
      billing: undefined, month: MONTH, allowanceMicros: 100,
    })
    expect(f.paidMicros).toBe(10)
    expect(f.totalMicros).toBe(40)
    expect(f.level).toBe('within')
    expect(f.share).toBeCloseTo(0.1)
  })

  // A new month starts clean: the allowance is monthly, and the old figure
  // simply is not this month's.
  it('starts a month with nothing on it at zero', () => {
    const f = fairUseOf({ aiCost: { '2026-08': { paid: 999 } }, billing: undefined, month: MONTH, allowanceMicros: 100 })
    expect(f.paidMicros).toBe(0)
    expect(f.level).toBe('within')
  })

  it('reports an account past the line as exceeded', () => {
    const f = fairUseOf({ aiCost: { [MONTH]: { paid: 150 } }, billing: undefined, month: MONTH, allowanceMicros: 100 })
    expect(f.level).toBe('exceeded')
    expect(f.share).toBeCloseTo(1.5)
  })

  // Enterprise pays its own AI. Showing it as "over" would be telling an
  // organisation it had used up something it never draws on.
  it('never reports an Enterprise account as over', () => {
    const f = fairUseOf({ aiCost: { [MONTH]: { paid: 10_000 } }, billing: ENTERPRISE, month: MONTH, allowanceMicros: 100 })
    expect(f.enterprise).toBe(true)
    expect(f.level).toBe('within')
  })

  it('knows an Enterprise account from any other', () => {
    expect(isEnterprise(ENTERPRISE)).toBe(true)
    expect(isEnterprise(undefined)).toBe(false)
    expect(isEnterprise({ enterprise: null } as unknown as Billing)).toBe(false)
  })
})

describe('when it starts again', () => {
  it('is the first of the next month', () => {
    expect(allowanceResetsOn('2026-09')).toBe('1 October')
  })

  it('rolls over the year', () => {
    expect(allowanceResetsOn('2026-12')).toBe('1 January')
  })
})
