import { describe, it, expect } from 'vitest'
import { resolveEntitlement, duePrompt, GRACE_MS, type Billing } from '@/lib/entitlement'

const NOW = Date.UTC(2026, 0, 15)
const DAY = 24 * 60 * 60 * 1000

function billing(over: Partial<Billing> = {}): Billing {
  return { subscriptionStatus: 'active', paymentMethodStatus: 'active', ...over } as Billing
}

describe('resolveEntitlement', () => {
  it('lets a doctor with no billing record through', () => {
    // Every existing doctor is in this state until the sweep backfills them.
    const e = resolveEntitlement(undefined, NOW)
    expect(e.entitled).toBe(true)
    expect(e.state).toBe('legacy')
  })

  it('honours an exemption before anything else', () => {
    const e = resolveEntitlement(billing({ subscriptionStatus: 'canceled', paywalledAt: NOW - DAY, billingExempt: true }), NOW)
    expect(e.entitled).toBe(true)
    expect(e.state).toBe('exempt')
  })

  it('paywalls once the sweep has flipped paywalledAt', () => {
    const e = resolveEntitlement(billing({ subscriptionStatus: 'trialing', paywalledAt: NOW - DAY }), NOW)
    expect(e.entitled).toBe(false)
    expect(e.state).toBe('paywalled')
  })

  it('entitles a trial', () => {
    expect(resolveEntitlement(billing({ subscriptionStatus: 'trialing', paymentMethodStatus: 'none' }), NOW).state).toBe('trialing')
  })

  it('entitles an active subscription', () => {
    expect(resolveEntitlement(billing(), NOW).state).toBe('active')
  })

  describe('past_due', () => {
    it('is entitled while a card is being retried', () => {
      const e = resolveEntitlement(billing({ subscriptionStatus: 'past_due', paymentMethodStatus: 'active' }), NOW)
      expect(e.entitled).toBe(true)
      expect(e.state).toBe('dunning')
    })

    it('is entitled while a BECS debit is still settling', () => {
      // The reason this app must not compute access from a date: a bank debit
      // takes days, and the money is already moving.
      const e = resolveEntitlement(billing({ subscriptionStatus: 'past_due', paymentMethodStatus: 'pending' }), NOW)
      expect(e.entitled).toBe(true)
      expect(e.state).toBe('dunning')
    })

    it('is entitled inside the grace window with nothing on file', () => {
      const e = resolveEntitlement(billing({ subscriptionStatus: 'past_due', paymentMethodStatus: 'none', gracePeriodEnd: NOW + DAY }), NOW)
      expect(e.entitled).toBe(true)
      expect(e.state).toBe('grace')
    })

    it('is paywalled once the grace window has passed', () => {
      const e = resolveEntitlement(billing({ subscriptionStatus: 'past_due', paymentMethodStatus: 'none', gracePeriodEnd: NOW - 1 }), NOW)
      expect(e.entitled).toBe(false)
      expect(e.state).toBe('paywalled')
    })
  })

  describe('paused', () => {
    it('keeps access until the paid period actually ends', () => {
      const e = resolveEntitlement(billing({ paused: true, currentPeriodEnd: NOW + DAY }), NOW)
      expect(e.entitled).toBe(true)
      expect(e.state).toBe('paused')
    })

    it('stops once that period has ended', () => {
      const e = resolveEntitlement(billing({ paused: true, currentPeriodEnd: NOW - 1 }), NOW)
      expect(e.entitled).toBe(false)
    })
  })

  it.each(['unpaid', 'canceled', 'incomplete_expired', 'incomplete'] as const)('paywalls %s', status => {
    expect(resolveEntitlement(billing({ subscriptionStatus: status }), NOW).entitled).toBe(false)
  })

  it('fails OPEN on a status it does not recognise', () => {
    // An unrecognised status is our gap. Wrongly billing someone is
    // recoverable; wrongly blocking a clinician mid-clinic is not.
    const e = resolveEntitlement(billing({ subscriptionStatus: 'something_stripe_added_later' as Billing['subscriptionStatus'] }), NOW)
    expect(e.entitled).toBe(true)
    expect(e.reason).toBe('unknown status')
  })

  it('never leaks anything clinical or personal in the reason', () => {
    const states: Billing[] = [
      billing(),
      billing({ subscriptionStatus: 'trialing' }),
      billing({ subscriptionStatus: 'past_due', paymentMethodStatus: 'none' }),
      billing({ paywalledAt: NOW }),
    ]
    for (const b of states) {
      const { reason } = resolveEntitlement(b, NOW)
      expect(reason.length).toBeLessThan(60)
      expect(reason).not.toMatch(/@|cus_|sub_|pm_/)
    }
  })

  it('agrees with itself for the same input — client and server cannot diverge', () => {
    const b = billing({ subscriptionStatus: 'past_due', paymentMethodStatus: 'none', gracePeriodEnd: NOW + GRACE_MS })
    expect(resolveEntitlement(b, NOW)).toEqual(resolveEntitlement(b, NOW))
  })
})

describe('duePrompt', () => {
  it('is silent for an exempt doctor', () => {
    expect(duePrompt(billing({ billingExempt: true, trialEndsAt: NOW - DAY }), NOW)).toBe(null)
  })

  it('is silent once a payment method is on file', () => {
    expect(duePrompt(billing({ paymentMethodStatus: 'active', trialEndsAt: NOW + DAY }), NOW)).toBe(null)
    expect(duePrompt(billing({ paymentMethodStatus: 'pending', trialEndsAt: NOW + DAY }), NOW)).toBe(null)
  })

  it('warns seven days out', () => {
    expect(duePrompt(billing({ paymentMethodStatus: 'none', trialEndsAt: NOW + 6 * DAY }), NOW)).toBe('trialReminder7d')
  })

  it('says nothing eight days out', () => {
    expect(duePrompt(billing({ paymentMethodStatus: 'none', trialEndsAt: NOW + 8 * DAY }), NOW)).toBe(null)
  })

  it('escalates on and after the trial-end day, not only on it', () => {
    expect(duePrompt(billing({ paymentMethodStatus: 'none', trialEndsAt: NOW }), NOW)).toBe('trialReminderDue')
    expect(duePrompt(billing({ paymentMethodStatus: 'none', trialEndsAt: NOW - 3 * DAY }), NOW)).toBe('trialReminderDue')
  })

  it('reports the paywall over any trial date', () => {
    expect(duePrompt(billing({ paymentMethodStatus: 'none', paywalledAt: NOW, trialEndsAt: NOW + 30 * DAY }), NOW)).toBe('paywalled')
  })
})
