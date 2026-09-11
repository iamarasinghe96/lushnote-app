import { describe, it, expect } from 'vitest'
import {
  shouldShowUpgradeNotice,
  canUpgrade,
  dismissedToday,
  quotaDay,
} from '@/lib/quotaNotice'
import { resolveGroqKey } from '@/lib/serverAiKeys'
import type { EntitlementState } from '@/lib/entitlement'

// Running out of Gemini is ordinary use, not an edge case: the free tier is 20
// requests a day and one long consultation spends ten transcribing. So this is
// a message a working doctor sees regularly, and the rules about when NOT to
// show it matter more than the rules about when to.

const ALL_STATES: EntitlementState[] = [
  'trialing', 'active', 'paused', 'grace', 'dunning', 'paywalled', 'exempt', 'legacy',
]

describe('shouldShowUpgradeNotice', () => {
  const base = { limitHit: true, state: 'trialing' as EntitlementState, dismissed: false }

  it('shows when a trialing doctor hits the daily limit', () => {
    expect(shouldShowUpgradeNotice(base)).toBe(true)
  })

  it('never shows to somebody who already pays', () => {
    // Offering "Upgrade to Pro" to an active subscriber is selling them what
    // they already bought, and reads as the app not knowing who they are.
    for (const state of ['active', 'dunning', 'grace', 'paused'] as EntitlementState[]) {
      expect(shouldShowUpgradeNotice({ ...base, state })).toBe(false)
    }
  })

  it('never shows to an exempt account', () => {
    // The e2e fixture and any comped account. Nothing to sell.
    expect(shouldShowUpgradeNotice({ ...base, state: 'exempt' })).toBe(false)
  })

  it('does not show before the limit is actually hit', () => {
    // Driven by the server's verdict, never by the local X/20 counter, which
    // mirrors Google's count imperfectly and drifts from it.
    expect(shouldShowUpgradeNotice({ ...base, limitHit: false })).toBe(false)
  })

  it('stays quiet once dismissed', () => {
    expect(shouldShowUpgradeNotice({ ...base, dismissed: true })).toBe(false)
  })

  it('has a defined answer for every entitlement state', () => {
    // A state added later must not fall through to an accidental `undefined`,
    // which would render as "no notice" and hide the upsell silently.
    for (const state of ALL_STATES) {
      expect(typeof shouldShowUpgradeNotice({ ...base, state })).toBe('boolean')
    }
  })
})

describe('canUpgrade', () => {
  it('is true only where there is somewhere to upgrade to', () => {
    expect(canUpgrade('trialing')).toBe(true)
    expect(canUpgrade('legacy')).toBe(true)
    expect(canUpgrade('active')).toBe(false)
  })

  it('is false for a paywalled doctor', () => {
    // They are already being asked for payment by the paywall itself; a second
    // upsell on top of it is noise at the worst moment.
    expect(canUpgrade('paywalled')).toBe(false)
  })
})

describe('dismissedToday', () => {
  it('silences the notice for the rest of the day it was dismissed', () => {
    expect(dismissedToday('2026-09-10', '2026-09-10')).toBe(true)
  })

  it('lets it return once the quota has reset', () => {
    // Dismissal lasts until the quota does. Forever would silence the one
    // message explaining why the app changed behaviour.
    expect(dismissedToday('2026-09-09', '2026-09-10')).toBe(false)
  })

  it('treats a missing or junk value as not dismissed', () => {
    expect(dismissedToday(null, '2026-09-10')).toBe(false)
    expect(dismissedToday('', '2026-09-10')).toBe(false)
  })

  it('ignores surrounding whitespace', () => {
    expect(dismissedToday(' 2026-09-10 ', '2026-09-10')).toBe(true)
  })
})

describe('quotaDay', () => {
  it('is UTC, matching the boundary Google resets on', () => {
    // A local-midnight day would unsilence the notice hours early or late
    // depending on the doctor's timezone.
    expect(quotaDay(new Date('2026-09-10T23:30:00Z'))).toBe('2026-09-10')
    expect(quotaDay(new Date('2026-09-11T00:30:00Z'))).toBe('2026-09-11')
  })
})

describe('resolveGroqKey', () => {
  const OWN = 'gsk_the_doctors_own_key'

  it("prefers the doctor's own key over ours", () => {
    // Theirs costs us nothing and has its own limits; ours is the safety net.
    // Preferring ours would exhaust the shared key everyone else depends on.
    expect(resolveGroqKey(OWN)).toEqual({ key: OWN, shared: false })
  })

  it('falls back to the shared key when the doctor has none', () => {
    const prev = process.env.LUSHNOTE_GROQ_KEY
    process.env.LUSHNOTE_GROQ_KEY = 'gsk_lushnote'
    try {
      expect(resolveGroqKey(null)).toEqual({ key: 'gsk_lushnote', shared: true })
    } finally {
      if (prev === undefined) delete process.env.LUSHNOTE_GROQ_KEY
      else process.env.LUSHNOTE_GROQ_KEY = prev
    }
  })

  it('reports no key rather than an empty string when neither exists', () => {
    // An empty string would reach the provider as a credential and come back a
    // 401, which reads as a rejected key rather than a missing one.
    const prev = process.env.LUSHNOTE_GROQ_KEY
    delete process.env.LUSHNOTE_GROQ_KEY
    try {
      expect(resolveGroqKey(null)).toEqual({ key: null, shared: false })
      expect(resolveGroqKey('   ')).toEqual({ key: null, shared: false })
    } finally {
      if (prev !== undefined) process.env.LUSHNOTE_GROQ_KEY = prev
    }
  })

  it('treats a whitespace-only user key as absent', () => {
    const prev = process.env.LUSHNOTE_GROQ_KEY
    process.env.LUSHNOTE_GROQ_KEY = 'gsk_lushnote'
    try {
      expect(resolveGroqKey('  ')).toEqual({ key: 'gsk_lushnote', shared: true })
    } finally {
      if (prev === undefined) delete process.env.LUSHNOTE_GROQ_KEY
      else process.env.LUSHNOTE_GROQ_KEY = prev
    }
  })
})
