// Stripe's decline codes, said the way a doctor can act on them.
//
// The codes themselves are Stripe's vocabulary and mean nothing to the person
// who has to fix it: "debit_not_authorized" is not an instruction. Each line
// below names what the bank did and what to do about it, and anything not on
// the list still gets a sentence rather than a raw code, because the list will
// never be complete and a blank space is worse than a general answer.
//
// Pure, so the wording is testable without a payment.

const REASONS: Record<string, string> = {
  insufficient_funds: 'Your bank declined the debit because there was not enough in the account.',
  account_closed: 'Your bank says that account is closed.',
  no_account: 'Your bank could not find that account. The BSB or account number may have a digit wrong.',
  invalid_account_number: 'Your bank could not find that account. The BSB or account number may have a digit wrong.',
  account_number_invalid: 'Your bank could not find that account. The BSB or account number may have a digit wrong.',
  routing_number_invalid: 'That BSB was not recognised.',
  debit_not_authorized: 'Your bank has not authorised direct debits on that account. They can lift that block for you.',
  bank_account_declined: 'Your bank declined the debit. They can tell you why.',
  bank_account_restricted: 'There is a restriction on that account that stops direct debits.',
  bank_account_unusable: 'That account cannot be used for direct debits.',
  card_declined: 'Your bank declined the card.',
  expired_card: 'That card has expired.',
  incorrect_number: 'That card number was not accepted.',
  incorrect_cvc: 'The security code on that card was not accepted.',
  processing_error: 'Something went wrong at the bank while the payment was being taken.',
}

const GENERAL = 'Your bank did not complete the payment.'

/** What happened, in a sentence. Never empty, whatever Stripe sent. */
export function paymentFailureReason(code: string | null | undefined): string {
  if (!code) return GENERAL
  return REASONS[code] ?? GENERAL
}
