import { describe, it, expect } from 'vitest'
import { BASE_PAYMENT_METHOD_TYPES } from '@/lib/billing'

// The history here is the point, because this file asserted the wrong thing
// once already and the assertion passed while production was broken.
//
// MONETIZATION_PLAN.md D5 flagged one VERIFY: does BECS surface through
// `automatic_payment_methods`. The element showed Card, Pix, Klarna and
// Satispay and no BECS, which was read as "automatic does not surface BECS",
// and the plan's fallback - naming `['card','au_becs_debit']` explicitly - was
// applied. This test then pinned that pair.
//
// It was the wrong reading. Automatic offers what the ACCOUNT has activated,
// which is why the three unwanted methods appeared and the wanted one did not:
// BECS had never been switched on. Naming an unactivated method explicitly does
// not quietly omit it - Stripe rejects the whole SetupIntent - so the billing
// page lost its form entirely and no doctor could add a card either.
//
// So the list is no longer a constant to pin. `paymentMethodTypesFor()` asks
// the account, which needs Stripe and belongs to the browser suite. What stays
// testable is the floor: a card is always on offer, whatever the answer.

describe('payment methods', () => {
  it('always offers a card', () => {
    expect([...BASE_PAYMENT_METHOD_TYPES]).toContain('card')
  })

  // The base list is what is used when the capability lookup says no, and when
  // it throws. A doctor overseas has no use for BECS and every use for this.
  it('needs nothing activated beyond a card', () => {
    expect([...BASE_PAYMENT_METHOD_TYPES]).toEqual(['card'])
  })

  // Named individually so a regression says which one came back. These are the
  // three that actually appeared, and none can bill an off-session AUD
  // subscription the way this one needs.
  it.each(['pix', 'klarna', 'satispay', 'afterpay_clearpay', 'affirm', 'alipay'])(
    'never offers %s',
    method => {
      expect([...BASE_PAYMENT_METHOD_TYPES]).not.toContain(method)
    },
  )

  // BECS is deliberately NOT here. Whether it is offered is a fact about the
  // Stripe account, not about this code, and asserting it either way would be
  // restating an assumption - which is the mistake this file already made.
  it('does not assert BECS either way', () => {
    expect([...BASE_PAYMENT_METHOD_TYPES]).not.toContain('au_becs_debit')
  })
})
