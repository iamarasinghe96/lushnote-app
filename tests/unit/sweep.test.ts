import { describe, it, expect } from 'vitest'
import { sweepAction, type SweepRow } from '@/lib/firestore/billingSweep'
import type { Billing } from '@/lib/entitlement'

const NOW = Date.UTC(2026, 0, 15)
const DAY = 24 * 60 * 60 * 1000

function row(over: Partial<SweepRow> = {}, billing?: Partial<Billing>): SweepRow {
  return { uid: 'u1', onboardingComplete: true, ...over, billing: billing as Billing | undefined }
}

const expired: Partial<Billing> = { gracePeriodEnd: NOW - DAY, paymentMethodStatus: 'none' }

describe('sweepAction', () => {
  it('leaves a suspended account alone entirely', () => {
    // A suspended doctor has no access to take away and no trial to start.
    expect(sweepAction(row({ status: 'disabled' }, expired), NOW)).toBe('skip')
  })

  it('paywalls a grace window that has run out with nothing on file', () => {
    expect(sweepAction(row({}, expired), NOW)).toBe('paywall')
  })

  it('does not paywall while the window is still open', () => {
    expect(sweepAction(row({}, { gracePeriodEnd: NOW + DAY, paymentMethodStatus: 'none', stripeCustomerId: 'cus_1' }), NOW)).toBe('skip')
  })

  it('does not paywall when a payment method is on file', () => {
    for (const paymentMethodStatus of ['active', 'pending'] as const) {
      expect(sweepAction(row({}, { gracePeriodEnd: NOW - DAY, paymentMethodStatus, stripeCustomerId: 'cus_1' }), NOW)).toBe('skip')
    }
  })

  it('does not paywall an exempt doctor', () => {
    expect(sweepAction(row({}, { ...expired, billingExempt: true, stripeCustomerId: 'cus_1' }), NOW)).toBe('skip')
  })

  it('is idempotent — an already-paywalled doctor is not paywalled again', () => {
    // The sweep runs every night forever; a second pass must change nothing.
    expect(sweepAction(row({}, { ...expired, paywalledAt: NOW - DAY }), NOW)).toBe('skip')
  })

  it('backfills a finished signup that has no Stripe customer', () => {
    expect(sweepAction(row(), NOW)).toBe('backfill')
  })

  it('backfills when consent was recorded but the customer call failed', () => {
    expect(sweepAction(row({}, { consentAcceptedAt: NOW - DAY } as Partial<Billing>), NOW)).toBe('backfill')
  })

  it('does not backfill an unfinished signup', () => {
    expect(sweepAction(row({ onboardingComplete: false }), NOW)).toBe('skip')
    expect(sweepAction(row({ onboardingComplete: undefined }), NOW)).toBe('skip')
  })

  it('does not start a second trial for someone who already has a customer', () => {
    expect(sweepAction(row({}, { stripeCustomerId: 'cus_1', subscriptionStatus: 'trialing' }), NOW)).toBe('skip')
  })

  it('paywalls before it backfills, so tonight the email matches tonight state', () => {
    // Both conditions true at once: no customer id AND an expired grace window.
    expect(sweepAction(row({}, expired), NOW)).toBe('paywall')
  })
})
