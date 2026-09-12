import { describe, it, expect } from 'vitest'
import { resolveAiKeys, PRO_MONTHLY_CEILING_MICROS } from '@/lib/serverAiKeys'
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
  'legacy', 'exempt', 'trialing', 'active', 'grace', 'dunning', 'paused', 'paywalled',
]

const KEYS = {
  userGeminiKey: 'user-gemini',
  userGroqKey: 'user-groq',
  proGeminiKey: 'pro-gemini',
  sharedGroqKey: 'shared-groq',
}

function resolve(state: EntitlementState, over: Partial<Parameters<typeof resolveAiKeys>[0]> = {}) {
  return resolveAiKeys({ state, monthSpendMicros: 0, ...KEYS, ...over })
}

describe('who gets the paid keys', () => {
  it('serves exactly the four states that have paid or were granted', () => {
    expect([...PRO_STATES].sort()).toEqual(['active', 'dunning', 'exempt', 'paused'])
  })

  it.each(['active', 'dunning', 'paused', 'exempt'] as EntitlementState[])(
    '%s is served by LushNote',
    state => {
      const r = resolve(state)
      expect(r.pro).toBe(true)
      expect(r.geminiKey).toBe('pro-gemini')
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

  it('never treats mere entitlement as having paid', () => {
    // grace and legacy are both entitled: true, and neither has paid.
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

describe('the fair-use ceiling', () => {
  // Ships off. A number guessed before any real data either never fires or
  // fires on somebody doing ordinary work.
  it('is disabled until real figures exist', () => {
    expect(PRO_MONTHLY_CEILING_MICROS).toBe(0)
  })

  it('does nothing while disabled, however much was spent', () => {
    const r = resolve('active', { monthSpendMicros: 999_999_999 })
    expect(r.pro).toBe(true)
    expect(r.degraded).toBe(false)
  })

  // The degrade path, exercised through an injected ceiling so that turning the
  // real one on is not the first time this branch has ever run.
  it('hands a doctor back to their own key rather than blocking them', () => {
    const r = resolve('active', { monthSpendMicros: 100, ceilingMicros: 50 })
    expect(r.degraded).toBe(true)
    expect(r.pro).toBe(false)
    expect(r.geminiKey).toBe('user-gemini')
  })

  it('still leaves a doctor with no key of their own something to run on', () => {
    const r = resolve('active', {
      monthSpendMicros: 100, ceilingMicros: 50,
      userGeminiKey: null, userGroqKey: null,
    })
    expect(r.degraded).toBe(true)
    expect(r.groqKey).toBe('shared-groq')
  })

  it('stays on the paid key right up to the ceiling', () => {
    const r = resolve('active', { monthSpendMicros: 49, ceilingMicros: 50 })
    expect(r.pro).toBe(true)
    expect(r.degraded).toBe(false)
  })

  it('does not degrade a doctor who was never Pro', () => {
    const r = resolve('trialing', { monthSpendMicros: 100, ceilingMicros: 50 })
    expect(r.degraded).toBe(false)
  })
})
