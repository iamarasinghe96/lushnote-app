import { describe, it, expect } from 'vitest'
import { resolveAiKeys, FREE_KEY_HANDOVER_AT, onLushnoteKey } from '@/lib/serverAiKeys'
import { FAIR_USE_ALLOWANCE_MICROS } from '@/lib/fairUse'
import { GEMINI_RPD } from '@/lib/gemini'
import { isProState, PRO_STATES } from '@/lib/entitlement'
import type { EntitlementState } from '@/lib/entitlement'

// This function decides WHO PAYS for an AI call, so it is the one place a
// mistake costs real money in either direction: serve a trial doctor on our
// paid key and we fund three months of their API before they decide anything;
// refuse a paying doctor and they are back to 20 notes a day having paid $30.
//
// The trap it exists to avoid: `entitled: true` is not the test. Half the
// entitled states have never sent us a penny - trialing, legacy and grace are
// all entitled without money moving.

const ALL_STATES: EntitlementState[] = [
  'legacy', 'exempt', 'trialing', 'active', 'grace', 'dunning', 'failed', 'paused', 'paywalled',
]

const KEYS = {
  userGeminiKey: 'user-gemini',
  userGroqKey: 'user-groq',
  proGeminiKey: 'pro-gemini',
  sharedGroqKey: 'shared-groq',
}

function resolve(state: EntitlementState, over: Partial<Parameters<typeof resolveAiKeys>[0]> = {}) {
  return resolveAiKeys({ state, paidSpendMicros: 0, enterprise: false, freeKeyUsedToday: 0, ...KEYS, ...over })
}

describe('who gets the paid keys', () => {
  it('serves exactly the four states that have paid or were granted', () => {
    expect([...PRO_STATES].sort()).toEqual(['active', 'dunning', 'exempt', 'paused'])
  })

  // Backed, not necessarily served: while their own free key has most of its
  // day left it answers first, and the paid key stands directly behind it.
  it.each(['active', 'dunning', 'paused', 'exempt'] as EntitlementState[])(
    '%s is backed by LushNote',
    state => {
      const r = resolve(state)
      expect(r.pro).toBe(true)
      expect([r.geminiKey, r.geminiHandoverKey]).toContain('pro-gemini')
    },
  )

  // The whole point of the upgrade. A trial doctor on our key would mean paying
  // their bill for three months before they decide anything.
  it.each(['trialing', 'legacy', 'grace', 'paywalled'] as EntitlementState[])(
    '%s keeps their own key',
    state => {
      const r = resolve(state)
      expect(r.pro).toBe(false)
      expect(r.geminiKey).toBe('user-gemini')
    },
  )

  // Not even as a fallback. A handover key on a trial doctor would quietly put
  // their failed requests on our bill.
  it.each(['trialing', 'legacy', 'grace', 'paywalled'] as EntitlementState[])(
    '%s is never handed over to the paid key',
    state => {
      expect(resolve(state).geminiHandoverKey).toBeNull()
      expect(resolve(state, { freeKeyUsedToday: 999 }).geminiHandoverKey).toBeNull()
    },
  )

  it('never treats mere entitlement as having paid', () => {
    // grace and legacy are both entitled: true, and neither has paid.
    // A bounced payment is not money in flight. The key stops with it.
    expect(isProState('failed')).toBe(false)
    expect(isProState('grace')).toBe(false)
    expect(isProState('legacy')).toBe(false)
    expect(isProState('trialing')).toBe(false)
  })
})

describe('nobody is ever left without a key', () => {
  it.each(ALL_STATES)('%s gets something to run on', state => {
    const r = resolve(state)
    expect(r.geminiKey || r.groqKey).toBeTruthy()
  })

  // A configuration fault, not a reason to fail a doctor mid-clinic.
  it('falls back to the doctor when the Pro key is missing', () => {
    const r = resolve('active', { proGeminiKey: null, sharedGroqKey: null })
    expect(r.pro).toBe(false)
    expect(r.geminiKey).toBe('user-gemini')
  })

  it('falls back when the Pro key is blank rather than absent', () => {
    const r = resolve('active', { proGeminiKey: '   ', sharedGroqKey: null })
    expect(r.geminiKey).toBe('user-gemini')
  })

  // A free-tier doctor with no Groq key of their own still gets the shared one -
  // this is the existing safety net and Pro must not have removed it.
  it('keeps the shared Groq net for a doctor with no key at all', () => {
    const r = resolve('trialing', { userGeminiKey: null, userGroqKey: null })
    expect(r.groqKey).toBe('shared-groq')
    expect(r.sharedGroq).toBe(true)
  })

  it('reports a doctor on their own Groq key as not shared', () => {
    expect(resolve('trialing').sharedGroq).toBe(false)
  })
})

// Fair use: the line past which an account costs LushNote more in AI than its
// subscription brings in. Measured on OUR keys only - see lib/fairUse.ts.
describe('the fair-use allowance', () => {
  // On, now. It used to ship at 0 = disabled while there were no figures; the
  // owner has since set the rule - past break-even an account is using more
  // than its share - so the allowance is what the subscription nets.
  it('is switched on, at a real figure', () => {
    expect(FAIR_USE_ALLOWANCE_MICROS).toBeGreaterThan(0)
  })

  it('is what the routes use when no allowance is passed in', () => {
    expect(resolve('active', { paidSpendMicros: FAIR_USE_ALLOWANCE_MICROS - 1 }).degraded).toBe(false)
    expect(resolve('active', { paidSpendMicros: FAIR_USE_ALLOWANCE_MICROS }).degraded).toBe(true)
  })

  it('hands a doctor back to their own key rather than blocking them', () => {
    const r = resolve('active', { paidSpendMicros: 100, allowanceMicros: 50 })
    expect(r.degraded).toBe(true)
    expect(r.pro).toBe(false)
    expect(r.geminiKey).toBe('user-gemini')
  })

  it('still leaves a doctor with no key of their own something to run on', () => {
    const r = resolve('active', {
      paidSpendMicros: 100, allowanceMicros: 50,
      userGeminiKey: null, userGroqKey: null,
    })
    expect(r.degraded).toBe(true)
    expect(r.groqKey).toBe('shared-groq')
  })

  it('stays on the paid key right up to the allowance', () => {
    const r = resolve('active', { paidSpendMicros: 49, allowanceMicros: 50 })
    expect(r.pro).toBe(true)
    expect(r.degraded).toBe(false)
  })

  it('does not degrade a doctor who was never Pro', () => {
    const r = resolve('trialing', { paidSpendMicros: 100, allowanceMicros: 50 })
    expect(r.degraded).toBe(false)
  })

  // An allowance of 0 means none, not "already used up".
  it('treats an allowance of 0 as no allowance at all', () => {
    expect(resolve('active', { paidSpendMicros: 999, allowanceMicros: 0 }).degraded).toBe(false)
  })
})

// Enterprise: the same subscription, the AI on the organisation's own key.
describe('Enterprise', () => {
  // The agreement in one line: their key pays. Ours behind it, even as a
  // handover, would put their AI bill quietly back on us.
  it('runs on their own key with ours nowhere behind it', () => {
    const r = resolve('active', { enterprise: true })
    expect(r.geminiKey).toBe('user-gemini')
    expect(r.geminiHandoverKey).toBeNull()
    expect(r.lushnoteGeminiKey).toBeNull()
    expect(r.pro).toBe(false)
  })

  // Nothing of ours to use up, so there is nothing to be over.
  it('is never reported as over fair use, whatever was spent', () => {
    const r = resolve('active', { enterprise: true, paidSpendMicros: 10 * FAIR_USE_ALLOWANCE_MICROS })
    expect(r.degraded).toBe(false)
  })

  it('keeps the shared Groq net like everyone else', () => {
    const r = resolve('active', { enterprise: true, userGeminiKey: null, userGroqKey: null })
    expect(r.groqKey).toBe('shared-groq')
  })
})

// Which side of the fair-use line a call's cost lands on. Wrong here, and the
// allowance is measured on the doctor's own free key - which costs us nothing.
describe('who paid for a call', () => {
  it('names our Gemini key whenever it is in play', () => {
    expect(resolve('active').lushnoteGeminiKey).toBe('pro-gemini')
    expect(resolve('active', { freeKeyUsedToday: FREE_KEY_HANDOVER_AT }).lushnoteGeminiKey).toBe('pro-gemini')
  })

  it.each(['trialing', 'legacy', 'grace', 'paywalled', 'failed'] as EntitlementState[])(
    '%s never has our key in play', state => {
      expect(resolve(state).lushnoteGeminiKey).toBeNull()
    },
  )

  it('counts a call as ours only when our key answered it', () => {
    const keys = resolve('active')
    expect(onLushnoteKey(keys, 'pro-gemini')).toBe(true)
    expect(onLushnoteKey(keys, 'user-gemini')).toBe(false)
    // The shared free-tier path passes no key at all.
    expect(onLushnoteKey(keys, undefined)).toBe(false)
    expect(onLushnoteKey(keys, null)).toBe(false)
  })

  // Both null must not read as a match.
  it('does not count a keyless call as ours for a doctor with no key in play', () => {
    expect(onLushnoteKey(resolve('trialing'), null)).toBe(false)
  })
})

// The doctor's own free key first, the paid key behind it, and the day's
// switch made before Google's limit rather than at it.
describe('Pro: their free key first, then ours', () => {
  it('serves a Pro doctor on their own free key while the day is young', () => {
    const r = resolve('active', { freeKeyUsedToday: 0 })
    expect(r.geminiKey).toBe('user-gemini')
    expect(r.geminiHandoverKey).toBe('pro-gemini')
    expect(r.pro).toBe(true)
  })

  it('keeps the free key right up to the handover point', () => {
    const r = resolve('active', { freeKeyUsedToday: FREE_KEY_HANDOVER_AT - 1 })
    expect(r.geminiKey).toBe('user-gemini')
    expect(r.geminiHandoverKey).toBe('pro-gemini')
  })

  it('retires the free key for the rest of the day at the handover point', () => {
    const r = resolve('active', { freeKeyUsedToday: FREE_KEY_HANDOVER_AT })
    expect(r.geminiKey).toBe('pro-gemini')
    expect(r.geminiHandoverKey).toBeNull()
  })

  // The owner's requirement in one line: not the full quota, and never waiting
  // for the limit to be the thing that says stop.
  it('hands over with part of the free day still unspent', () => {
    expect(FREE_KEY_HANDOVER_AT).toBeGreaterThan(0)
    expect(FREE_KEY_HANDOVER_AT).toBeLessThan(GEMINI_RPD)
  })

  it('goes straight to the paid key for a Pro doctor with no key of their own', () => {
    const r = resolve('active', { userGeminiKey: null })
    expect(r.geminiKey).toBe('pro-gemini')
    expect(r.geminiHandoverKey).toBeNull()
  })

  // Nothing to hand over to: the free key serves alone, exactly as it did
  // before Pro existed, rather than a doctor being left with nothing.
  it('runs on the free key alone when the paid key is not configured', () => {
    const r = resolve('active', { proGeminiKey: null })
    expect(r.geminiKey).toBe('user-gemini')
    expect(r.geminiHandoverKey).toBeNull()
  })

  it('hands a degraded doctor back without a paid key behind them', () => {
    const r = resolve('active', { paidSpendMicros: 100, allowanceMicros: 50 })
    expect(r.geminiHandoverKey).toBeNull()
  })
})
