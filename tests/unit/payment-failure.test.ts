import { describe, expect, it } from 'vitest'
import { paymentFailureReason } from '@/lib/paymentFailure'

// The doctor has to know what to DO. "debit_not_authorized" is not an
// instruction, and a blank space is worse than a general answer.

describe('paymentFailureReason', () => {
  it('turns a known code into something actionable', () => {
    expect(paymentFailureReason('insufficient_funds')).toMatch(/not enough in the account/i)
    expect(paymentFailureReason('debit_not_authorized')).toMatch(/authorised direct debits/i)
    expect(paymentFailureReason('account_closed')).toMatch(/closed/i)
  })

  it('still says something for a code it has never seen', () => {
    const answer = paymentFailureReason('some_code_stripe_added_last_tuesday')
    expect(answer.length).toBeGreaterThan(20)
    expect(answer).not.toContain('some_code')
  })

  it('has an answer when Stripe sent no code at all', () => {
    expect(paymentFailureReason(null)).toBe(paymentFailureReason(undefined))
    expect(paymentFailureReason('')).toMatch(/did not complete/i)
  })

  // Every line is read by a doctor, so it has to be a sentence, not a label.
  it('reads as sentences', () => {
    for (const code of ['insufficient_funds', 'card_declined', 'no_account', 'unknown_code']) {
      const answer = paymentFailureReason(code)
      expect(answer.endsWith('.')).toBe(true)
      expect(answer[0]).toBe(answer[0].toUpperCase())
    }
  })
})
