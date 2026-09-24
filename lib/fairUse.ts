// Fair use: how much of LushNote's own AI spend one subscription covers.
//
// The subscription is a flat AUD $30 against a cost that grows with every note,
// and nothing stops one account being signed into by a whole ward. A single
// doctor costs a fraction of what they pay; ten clinicians sharing one login
// cost more than it brings in, and every note after that point is paid for by
// everyone else's subscription.
//
// So the line is drawn where the arithmetic turns: an account whose AI spend on
// LUSHNOTE'S keys passes what its subscription nets us in a month has used its
// fair share. Past that it is not blocked - nothing in this app blocks a
// clinician - it is handed back to its own key for the rest of the month, and
// told about Enterprise: the same subscription, with the AI on the
// organisation's own key and billed to them by the provider.
//
// PURE, for the same reason lib/entitlement.ts and lib/aiCost.ts are: the AI
// routes, the admin console and the doctor's own billing page must reach the
// same verdict from the same fields.
//
// ESTIMATED. The spend is our arithmetic over provider-reported token counts
// (lib/aiCost.ts), never an invoice, so every surface that shows it says so.

import { USD_TO_AUD, type Micros } from '@/lib/aiCost'
import type { AiCostMonth, User } from '@/types'

/** The subscription price. lib/billing.ts re-exports it as PRICE_AUD, so the
 *  price a doctor is charged and the allowance measured against it cannot
 *  drift apart. */
export const PLAN_PRICE_AUD = 30

/**
 * What the payment processor keeps, rounded up so the allowance errs towards
 * LushNote rather than past break-even. An Australian card is about 1.75% plus
 * 30 cents on $30 (2.75%), a bank debit less, an overseas card more; 4% covers
 * the common cases.
 */
export const PAYMENT_FEE_SHARE = 0.04

/** One month of the subscription, after fees, in micro-USD - the currency the
 *  cost meter records in. About 18.7 million, i.e. USD $18.70. */
export const NET_REVENUE_MICROS: Micros =
  Math.round((PLAN_PRICE_AUD / USD_TO_AUD) * (1 - PAYMENT_FEE_SHARE) * 1_000_000)

/**
 * The monthly fair-use allowance: LushNote-paid AI spend up to what the
 * subscription nets. Break-even, deliberately - the owner's rule is "when the
 * API cost exceeds the margin", and anything below this is an account that is
 * still paying its way.
 */
export const FAIR_USE_ALLOWANCE_MICROS: Micros = NET_REVENUE_MICROS

/** Where "approaching" starts. Early enough to tell a practice before the
 *  switch happens rather than in the same breath. */
export const FAIR_USE_WARN_SHARE = 0.8

export type FairUseLevel = 'within' | 'approaching' | 'exceeded'

export interface FairUse {
  month: string
  /** LushNote-paid spend this month. */
  paidMicros: Micros
  /** Everything metered this month, including calls the doctor's own key paid
   *  for. Context for the admin, never the measure. */
  totalMicros: Micros
  allowanceMicros: Micros
  /** paid / allowance. 1 means the allowance is used up exactly. */
  share: number
  level: FairUseLevel
  /** Enterprise accounts pay their own AI and have no allowance to use up. */
  enterprise: boolean
}

type Billing = NonNullable<User['billing']>

export function isEnterprise(billing: Billing | undefined | null): boolean {
  return !!billing?.enterprise
}

/**
 * The paid spend for one month. Months recorded before the split existed have
 * no `paid` field and read as 0: the old total also counted the doctor's own
 * key, and treating it as ours would have put accounts over on figures that
 * were never ours to begin with.
 */
export function paidSpend(month: Partial<AiCostMonth> | undefined | null): Micros {
  const v = month?.paid
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

export function fairUseLevel(paidMicros: Micros, allowanceMicros: Micros): FairUseLevel {
  if (allowanceMicros <= 0) return 'within'
  if (paidMicros >= allowanceMicros) return 'exceeded'
  if (paidMicros >= allowanceMicros * FAIR_USE_WARN_SHARE) return 'approaching'
  return 'within'
}

/**
 * Where an account stands this month. `month` is passed in (monthKey() at the
 * call site) rather than read from the clock, so this stays pure.
 */
export function fairUseOf(input: {
  aiCost: Record<string, Partial<AiCostMonth> | undefined> | null | undefined
  billing: Billing | undefined | null
  month: string
  allowanceMicros?: Micros
}): FairUse {
  const allowance = input.allowanceMicros ?? FAIR_USE_ALLOWANCE_MICROS
  const m = input.aiCost?.[input.month]
  const paid = paidSpend(m)
  const enterprise = isEnterprise(input.billing)
  return {
    month: input.month,
    paidMicros: paid,
    totalMicros: typeof m?.micros === 'number' ? m.micros : 0,
    allowanceMicros: allowance,
    share: allowance > 0 ? paid / allowance : 0,
    // An Enterprise account is never "over": there is nothing of ours to use up.
    level: enterprise ? 'within' : fairUseLevel(paid, allowance),
    enterprise,
  }
}

/**
 * "1 October" for a month of "2026-09": the day the allowance starts again, in
 * doctor-facing copy. Formatted in UTC so a browser west of Greenwich does not
 * render it as the last day of the month before.
 */
export function allowanceResetsOn(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}
