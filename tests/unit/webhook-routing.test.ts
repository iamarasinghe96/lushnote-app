import { describe, it, expect } from 'vitest'
import { subscriptionIdOf, customerIdOf, mandateStatusToPaymentStatus } from '@/lib/stripeEvents'

// Every payload below is a shape Stripe actually delivers. When one of these
// returns null the webhook falls through silently and the projection goes
// stale — no error, no log, just a doctor whose access stops matching what
// they have paid for.

describe('subscriptionIdOf', () => {
  it('reads an expanded subscription object', () => {
    expect(subscriptionIdOf({ subscription: { id: 'sub_expanded' } })).toBe('sub_expanded')
  })

  it('reads a plain subscription id, as an invoice carries it', () => {
    expect(subscriptionIdOf({ object: 'invoice', subscription: 'sub_plain' })).toBe('sub_plain')
  })

  it('treats a subscription event own object as the subscription', () => {
    expect(subscriptionIdOf({ object: 'subscription', id: 'sub_self' })).toBe('sub_self')
  })

  it('does not mistake another object own id for a subscription', () => {
    // A setup_intent has an id too. Returning it would send the projector
    // looking up a subscription that does not exist.
    expect(subscriptionIdOf({ object: 'setup_intent', id: 'seti_1', customer: 'cus_1' })).toBe(null)
  })

  it('returns null for a payload with no subscription at all', () => {
    expect(subscriptionIdOf({ object: 'payment_method', customer: 'cus_1' })).toBe(null)
    expect(subscriptionIdOf({})).toBe(null)
  })
})

describe('customerIdOf', () => {
  it('reads a plain customer id', () => {
    expect(customerIdOf({ customer: 'cus_plain' })).toBe('cus_plain')
  })

  it('reads an expanded customer object', () => {
    expect(customerIdOf({ customer: { id: 'cus_expanded' } })).toBe('cus_expanded')
  })

  it('returns null when there is no customer', () => {
    expect(customerIdOf({ object: 'subscription', id: 'sub_1' })).toBe(null)
    expect(customerIdOf({ customer: null })).toBe(null)
  })
})

describe('mandateStatusToPaymentStatus', () => {
  it('treats a live mandate as a payment method on file', () => {
    expect(mandateStatusToPaymentStatus('active')).toBe('active')
  })

  it('treats a settling mandate as pending, which still entitles', () => {
    expect(mandateStatusToPaymentStatus('pending')).toBe('pending')
  })

  it('treats anything else as nothing on file', () => {
    for (const s of ['inactive', 'canceled', '']) {
      expect(mandateStatusToPaymentStatus(s)).toBe('none')
    }
  })
})
