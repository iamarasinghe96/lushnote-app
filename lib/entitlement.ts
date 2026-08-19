// Who may use the paid features, decided from the Stripe state a webhook wrote.
//
// DELIBERATELY PURE: no Stripe SDK, no Firestore, no env. The client layout and
// the API routes must reach the same verdict from the same fields, and the only
// way to guarantee that is one function neither side can special-case. It also
// means the app never computes access from a date of its own — BECS debits
// settle over several business days, so "the trial ended, lock them out" would
// paywall a doctor whose money is already in flight.

import type { User } from '@/types'

export type Billing = NonNullable<User['billing']>

export type EntitlementState =
  | 'legacy'         // no billing record at all — predates the rollout
  | 'exempt'         // admin granted permanent free access
  | 'trialing'
  | 'active'
  | 'grace'          // trial ended with no payment method; still inside the window
  | 'dunning'        // a payment method exists and Stripe is retrying
  | 'paused'         // collection paused; paid period still running
  | 'paywalled'

export interface Entitlement {
  entitled: boolean
  state: EntitlementState
  /** Short, non-clinical, safe to log. */
  reason: string
}

/** Days of continued access after a trial ends with nothing on file. */
export const GRACE_DAYS = 7
export const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000

export function resolveEntitlement(billing: Billing | undefined, now: number): Entitlement {
  // Nobody has a billing record until the sweep backfills them. Treating that as
  // unpaid would lock out every existing doctor the moment this ships.
  if (!billing) return { entitled: true, state: 'legacy', reason: 'no billing record yet' }

  if (billing.billingExempt) return { entitled: true, state: 'exempt', reason: 'billing exempt' }

  // An explicit flip by the nightly sweep. Checked before status because Stripe
  // has no event for "the grace window ran out and nothing happened", so this
  // field is the only record of that decision.
  if (billing.paywalledAt) return { entitled: false, state: 'paywalled', reason: 'grace expired' }

  const hasMethod = billing.paymentMethodStatus === 'active' || billing.paymentMethodStatus === 'pending'

  switch (billing.subscriptionStatus) {
    case 'trialing':
      return { entitled: true, state: 'trialing', reason: 'in free trial' }

    case 'active':
      // cancel_at_period_end leaves the status 'active' until the period really
      // ends, so "cancel keeps access to the end of the month" needs no branch.
      if (billing.paused) {
        return now <= (billing.currentPeriodEnd ?? 0)
          ? { entitled: true, state: 'paused', reason: 'paused, paid period still running' }
          : { entitled: false, state: 'paywalled', reason: 'paused, period ended' }
      }
      return { entitled: true, state: 'active', reason: 'subscription active' }

    case 'past_due':
      // A method on file means Stripe is either retrying a card or waiting for a
      // bank debit to clear. Both are money in motion, not a lapsed account.
      if (hasMethod) return { entitled: true, state: 'dunning', reason: 'payment in progress' }
      if (billing.gracePeriodEnd && now <= billing.gracePeriodEnd) {
        return { entitled: true, state: 'grace', reason: 'grace window' }
      }
      return { entitled: false, state: 'paywalled', reason: 'no payment method' }

    // 'unpaid' is what the dashboard marks a subscription once Smart Retries are
    // exhausted, which makes it the real end of the dunning road.
    case 'unpaid':
    case 'canceled':
    case 'incomplete_expired':
      return { entitled: false, state: 'paywalled', reason: `subscription ${billing.subscriptionStatus}` }

    case 'incomplete':
      // First payment never completed. Only reachable if a trial was skipped.
      return { entitled: false, state: 'paywalled', reason: 'subscription incomplete' }

    default:
      // An unrecognised status is our gap, not the doctor's. Fail open: wrongly
      // billing someone is recoverable, wrongly blocking a clinician mid-clinic
      // is not.
      return { entitled: true, state: 'legacy', reason: 'unknown status' }
  }
}

/** Which payment prompt is due, or null. Same "on or after the threshold"
 *  semantics as the emails, so a doctor who misses the exact day still sees it. */
export function duePrompt(
  billing: Billing | undefined,
  now: number,
): 'trialReminder7d' | 'trialReminderDue' | 'paywalled' | null {
  if (!billing || billing.billingExempt) return null
  if (billing.paywalledAt) return 'paywalled'
  if (billing.paymentMethodStatus === 'active' || billing.paymentMethodStatus === 'pending') return null
  const end = billing.trialEndsAt
  if (!end) return null
  if (now >= end) return 'trialReminderDue'
  if (now >= end - 7 * 24 * 60 * 60 * 1000) return 'trialReminder7d'
  return null
}
