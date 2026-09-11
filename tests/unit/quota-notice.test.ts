import { describe, it, expect } from 'vitest'
import {
  shouldShowUpgradeNotice,
  canUpgrade,
  readShownAt,
  recordNoticeShown,
  MAX_UPGRADE_NOTICES,
  UPGRADE_NOTICE_GAP_DAYS,
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

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-11T00:00:00Z')

describe('shouldShowUpgradeNotice — twice, ever, a fortnight apart', () => {
  const base = { limitHit: true, state: 'trialing' as EntitlementState, shownAt: [] as number[], now: NOW }

  it('shows the first time a trialing doctor hits the limit', () => {
    expect(shouldShowUpgradeNotice(base)).toBe(true)
  })

  it('stays quiet for the fortnight after the first', () => {
    // A doctor hits this limit dozens of times in a trial. Saying it again the
    // next day is nagging somebody between patients about something that is
    // not stopping them.
    expect(shouldShowUpgradeNotice({ ...base, shownAt: [NOW - 1 * DAY] })).toBe(false)
    expect(shouldShowUpgradeNotice({ ...base, shownAt: [NOW - 13 * DAY] })).toBe(false)
  })

  it('shows a second time once the fortnight has passed', () => {
    expect(shouldShowUpgradeNotice({ ...base, shownAt: [NOW - 14 * DAY] })).toBe(true)
    expect(shouldShowUpgradeNotice({ ...base, shownAt: [NOW - 40 * DAY] })).toBe(true)
  })

  it('never shows a third time, however long has passed', () => {
    // The offer has been made. Twice is the whole budget for the trial.
    expect(shouldShowUpgradeNotice({ ...base, shownAt: [NOW - 200 * DAY, NOW - 100 * DAY] })).toBe(false)
  })

  it('spends exactly two notices across a whole three-month trial', () => {
    // Walks a real trial day by day and counts. This is the promise the doctor
    // was made, so it is asserted end to end rather than rule by rule.
    let shownAt: number[] = []
    let count = 0
    for (let day = 0; day < 90; day++) {
      const now = NOW + day * DAY
      // The limit is hit most days — that is the point of the feature.
      if (shouldShowUpgradeNotice({ limitHit: true, state: 'trialing', shownAt, now })) {
        count++
        shownAt = recordNoticeShown(shownAt, now)
      }
    }
    expect(count).toBe(MAX_UPGRADE_NOTICES)
    expect(shownAt).toHaveLength(2)
    expect(shownAt[1] - shownAt[0]).toBeGreaterThanOrEqual(UPGRADE_NOTICE_GAP_DAYS * DAY)
  })

  it('never shows to somebody who already pays', () => {
    for (const state of ['active', 'dunning', 'grace', 'paused'] as EntitlementState[]) {
      expect(shouldShowUpgradeNotice({ ...base, state })).toBe(false)
    }
  })

  it('never shows to an exempt or paywalled account', () => {
    // Exempt has nothing to sell; paywalled is already being asked for payment.
    expect(shouldShowUpgradeNotice({ ...base, state: 'exempt' })).toBe(false)
    expect(shouldShowUpgradeNotice({ ...base, state: 'paywalled' })).toBe(false)
  })

  it('does not show before the limit is actually hit', () => {
    expect(shouldShowUpgradeNotice({ ...base, limitHit: false })).toBe(false)
  })

  it('has a defined answer for every entitlement state', () => {
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
    expect(canUpgrade('paywalled')).toBe(false)
  })
})

describe('readShownAt', () => {
  it('survives whatever Firestore hands back', () => {
    // A junk entry that got through would either block the notice forever or
    // let it through every time, and both failures are silent.
    expect(readShownAt(null)).toEqual([])
    expect(readShownAt('nonsense')).toEqual([])
    expect(readShownAt([NOW, 'x', null, NaN, -1, 0])).toEqual([NOW])
  })

  it('sorts oldest first, so the gap is measured from the real last one', () => {
    expect(readShownAt([NOW, NOW - 5 * DAY])).toEqual([NOW - 5 * DAY, NOW])
  })
})

describe('recordNoticeShown', () => {
  it('counts a notice when it is SHOWN, not when it is dismissed', () => {
    // A doctor who sees it and navigates away has still been told. Treating
    // that as "not yet shown" would bring it back tomorrow.
    expect(recordNoticeShown([], NOW)).toEqual([NOW])
  })

  it('never grows past the budget', () => {
    const out = recordNoticeShown([NOW - 40 * DAY, NOW - 20 * DAY], NOW)
    expect(out).toHaveLength(MAX_UPGRADE_NOTICES)
    expect(out[out.length - 1]).toBe(NOW)
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
