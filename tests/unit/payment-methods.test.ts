import { describe, it, expect } from 'vitest'
import { PAYMENT_METHOD_TYPES } from '@/lib/billing'

// MONETIZATION_PLAN.md D5 planned `automatic_payment_methods` and flagged one
// thing to VERIFY: "BECS surfaces via automatic_payment_methods on SetupIntent;
// fallback = explicit payment_method_types: ['card','au_becs_debit']".
//
// It resolved negatively, in production. The element offered Card, Pix, Klarna
// and Satispay, and no BECS - directly under copy promising "direct debit from
// an Australian bank account". That list comes from the Stripe dashboard, not
// from the customer's location, so anything ticked there appeared.
//
// The plan's own fallback is now in force. This pins it, because the failure it
// prevents is invisible from inside this repo: a tick in a dashboard nobody is
// reading, offering a doctor a method the subscription may not be able to bill
// off-session months later.

describe('PAYMENT_METHOD_TYPES', () => {
  it('offers exactly the two methods the plan commits to', () => {
    expect([...PAYMENT_METHOD_TYPES]).toEqual(['card', 'au_becs_debit'])
  })

  // The page states both, so both have to be on offer. BECS is the one that was
  // missing, and it is the one an Australian doctor is most likely to want.
  it('includes BECS, which the billing page promises in writing', () => {
    expect(PAYMENT_METHOD_TYPES).toContain('au_becs_debit')
  })

  it('includes card, which is the worldwide path', () => {
    expect(PAYMENT_METHOD_TYPES).toContain('card')
  })

  // Named individually because these three are what actually appeared, and a
  // failure here should say which one came back rather than "length changed".
  it.each(['pix', 'klarna', 'satispay', 'afterpay_clearpay', 'affirm', 'alipay'])(
    'does not offer %s',
    method => {
      expect(PAYMENT_METHOD_TYPES).not.toContain(method)
    },
  )
})
