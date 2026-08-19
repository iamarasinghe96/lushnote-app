// Everything that knows Stripe exists lives here or in the two /api/stripe and
// /api/billing routes. The rest of the app consumes only the neutral `billing`
// map on the user doc and the pure resolver in lib/entitlement.ts — so if we
// ever move to a merchant of record, this file is replaced and the app is not.
//
// Server only: imports firebase-admin and reads STRIPE_SECRET_KEY.

import Stripe from 'stripe'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { resolveEntitlement, GRACE_MS, type Billing, type Entitlement } from '@/lib/entitlement'

// The secret key IS the feature flag. Without it every billing path no-ops and
// the app behaves exactly as it did before monetization — which is what keeps
// this shippable in layers instead of one release.
export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

let client: Stripe | null = null

/** Throws when Stripe isn't configured — callers check stripeEnabled() first. */
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  // Cached per warm instance. No apiVersion pin: the account's own default is
  // what the dashboard config was built against, and pinning here would silently
  // diverge from it.
  if (!client) client = new Stripe(key)
  return client
}

export function priceId(): string {
  const id = process.env.STRIPE_PRICE_ID
  if (!id) throw new Error('STRIPE_PRICE_ID is not set')
  return id
}

// ── Price display ──────────────────────────────────────────────────────────
// One amount for the world, denominated in AUD. A doctor in Dublin is charged
// AUD 30 and their own bank does the conversion, so there is no localised price
// to compute and no exchange rate for us to hold.
export const PRICE_AUD = 30
export const TRIAL_MONTHS = 3
/** The GST registration threshold that the admin turnover monitor watches. */
export const GST_THRESHOLD_AUD = 75000

/**
 * The price as doctors read it. GST is Australian and only ever applies to
 * Australian customers; exports of services are GST-free. The price is
 * tax-inclusive at Stripe, so registering does not change what anyone pays —
 * it changes what the invoice says, and only for Australians.
 */
export function priceString(gstRegistered: boolean, isAU: boolean): string {
  return gstRegistered && isAU ? `AUD $${PRICE_AUD}/month (incl. GST)` : `AUD $${PRICE_AUD}/month`
}

/** Shown wherever the price is, to anyone outside Australia. */
export const FX_NOTE =
  'Prices are in Australian dollars. If your card is issued outside Australia, your bank converts the charge and may add a small foreign-transaction fee.'

// ── Entitlement ────────────────────────────────────────────────────────────

/**
 * The server's answer to "may this doctor use the paid features". Reads the
 * webhook-written state and defers to the same pure resolver the client uses.
 *
 * A read failure returns entitled: losing Firestore for a moment must not lock
 * a clinician out of their own notes.
 */
export async function getEntitlement(uid: string, now = Date.now()): Promise<Entitlement> {
  if (!uid) return { entitled: true, state: 'legacy', reason: 'no uid' }
  try {
    const snap = await adminDb().collection('users').doc(uid).get()
    const billing = snap.exists ? (snap.data()?.billing as Billing | undefined) : undefined
    return resolveEntitlement(billing, now)
  } catch {
    return { entitled: true, state: 'legacy', reason: 'billing read failed' }
  }
}

// ── GST configuration ──────────────────────────────────────────────────────

export interface BillingConfig {
  gstRegistered: boolean
  gstEffectiveDate: string | null   // YYYY-MM-DD, local Australian date
  gstInclusive: boolean             // locked true: the Stripe price is inclusive
  turnoverCache?: {
    auTaxable12mCents: number
    computedAt: number
    byMonth: { month: string; cents: number }[]
  }
  updatedAt?: number
}

const DEFAULT_CONFIG: BillingConfig = {
  gstRegistered: false,
  gstEffectiveDate: null,
  gstInclusive: true,
}

/** Admin-SDK read of `config/billing`. Missing doc = not registered. */
export async function getBillingConfig(): Promise<BillingConfig> {
  try {
    const snap = await adminDb().collection('config').doc('billing').get()
    if (!snap.exists) return { ...DEFAULT_CONFIG }
    return { ...DEFAULT_CONFIG, ...(snap.data() as Partial<BillingConfig>) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

// ── Projection: Stripe → users/{uid}.billing ───────────────────────────────
//
// Every webhook refetches the subscription and writes CURRENT truth rather than
// projecting the event payload. Stripe does not promise delivery order, and a
// stale "trialing" arriving after "active" would otherwise hand back access
// that had already been paid for. Refetching makes order irrelevant and every
// event self-healing: whatever we missed, the next one repairs.

/** `expand` used everywhere a subscription is projected. */
const SUB_EXPAND = ['default_payment_method', 'customer']

function unwrapId(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null
  return typeof v === 'string' ? v : v.id
}

async function paymentMethodState(
  sub: Stripe.Subscription,
  customer: Stripe.Customer,
  previous: Billing | undefined,
): Promise<Pick<Billing, 'paymentMethodId' | 'paymentMethodType' | 'paymentMethodStatus' | 'mandateId' | 'country'>> {
  const s = stripe()
  // The subscription's own method wins; otherwise the customer default, which is
  // what a SetupIntent sets and what Stripe bills against when the subscription
  // names none.
  let pm = sub.default_payment_method as Stripe.PaymentMethod | string | null
  if (!pm) pm = customer.invoice_settings?.default_payment_method ?? null
  const pmId = unwrapId(pm)
  if (!pmId) {
    return { paymentMethodId: null, paymentMethodType: null, paymentMethodStatus: 'none', mandateId: null, country: previous?.country ?? null }
  }

  const method = typeof pm === 'string' || !pm ? await s.paymentMethods.retrieve(pmId) : pm
  const type = method.type === 'au_becs_debit' ? 'au_becs_debit' : method.type === 'card' ? 'card' : null
  // Billing country is the only location fact we keep. It drives price display
  // and which invoices count towards Australian turnover; Stripe Tax makes the
  // actual tax determination from data we never see.
  const country = method.billing_details?.address?.country
    ?? (typeof customer.address?.country === 'string' ? customer.address.country : null)
    ?? previous?.country
    ?? null

  // A card is usable the moment it attaches. A BECS mandate is a separate object
  // the bank has to accept, so carry its id and read its real status.
  const mandateId = type === 'au_becs_debit' ? (previous?.mandateId ?? null) : null
  let status: Billing['paymentMethodStatus'] = type === 'au_becs_debit' ? 'pending' : 'active'
  if (mandateId) {
    try {
      const mandate = await s.mandates.retrieve(mandateId)
      status = mandate.status === 'active' ? 'active' : mandate.status === 'pending' ? 'pending' : 'none'
    } catch { /* keep the optimistic 'pending'; mandate.updated will correct it */ }
  }
  return { paymentMethodId: pmId, paymentMethodType: type, paymentMethodStatus: status, mandateId, country }
}

/**
 * Read a subscription from Stripe and write it onto the doctor's profile.
 * Returns the uid it wrote, or null when the customer carries no uid (a
 * subscription created outside this app).
 */
export async function projectSubscription(subscriptionId: string): Promise<string | null> {
  const s = stripe()
  const sub = await s.subscriptions.retrieve(subscriptionId, { expand: SUB_EXPAND })
  // A deleted customer is a different object shape with no metadata, so narrow
  // before reading the uid off it.
  const raw = sub.customer as Stripe.Customer | Stripe.DeletedCustomer
  if (!raw || raw.deleted === true) return null
  const customer = raw
  const uid = customer.metadata?.uid
  if (!uid) return null

  const ref = adminDb().collection('users').doc(uid)
  const previous = (await ref.get()).data()?.billing as Billing | undefined
  const pm = await paymentMethodState(sub, customer, previous)

  // In API 2349 the period moved OFF the subscription and onto its items — the
  // old `sub.current_period_end` no longer exists, and reading it would have
  // silently given every doctor a null period end (and so no paused cut-off).
  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? null
  const trialEndsAt = sub.trial_end ? sub.trial_end * 1000 : null

  const next: Billing = {
    stripeCustomerId: customer.id,
    subscriptionId: sub.id,
    subscriptionStatus: sub.status as Billing['subscriptionStatus'],
    trialEndsAt,
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    paused: !!sub.pause_collection,
    ...pm,
    // Opened once, when a trial ends with nothing on file. Never reopened: a
    // second trial-end event must not hand out a fresh week.
    gracePeriodEnd: previous?.gracePeriodEnd ?? null,
    paywalledAt: previous?.paywalledAt ?? null,
    ...(previous?.billingExempt !== undefined ? { billingExempt: previous.billingExempt } : {}),
    ...(previous?.consent ? { consent: previous.consent } : {}),
    updatedAt: Date.now(),
  }

  if (sub.status === 'past_due' && next.paymentMethodStatus === 'none' && !next.gracePeriodEnd) {
    next.gracePeriodEnd = (trialEndsAt ?? Date.now()) + GRACE_MS
  }
  // Money arrived, or a method did: whatever the sweep decided is void.
  if (next.paymentMethodStatus !== 'none' || sub.status === 'active' || sub.status === 'trialing') {
    next.gracePeriodEnd = null
    next.paywalledAt = null
  }

  await ref.set({ billing: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return uid
}

/** Project from a customer id when the event carries no subscription. */
export async function projectCustomer(customerId: string): Promise<string | null> {
  const subs = await stripe().subscriptions.list({ customer: customerId, limit: 1, status: 'all' })
  const sub = subs.data[0]
  return sub ? projectSubscription(sub.id) : null
}

// ── Trial creation ─────────────────────────────────────────────────────────

/** Three calendar months, not 90 days — "three months free" is what the copy
 *  promises, and a doctor who signs up on 30 November should keep February's
 *  shorter month rather than lose two days to arithmetic. Day-of-month overflow
 *  (31 May + 3 → 31 August exists, but 30 November + 3 → 28/29 February) is
 *  clamped by Date itself rolling forward, which errs in the doctor's favour. */
function trialEndSeconds(from = new Date()): number {
  const end = new Date(from)
  end.setMonth(end.getMonth() + TRIAL_MONTHS)
  return Math.floor(end.getTime() / 1000)
}

export interface StartTrialResult {
  created: boolean
  reason: string
  customerId?: string
  subscriptionId?: string
}

/**
 * Give a doctor their trial subscription. Idempotent by the customer id already
 * on their profile, because it is called from onboarding AND from the nightly
 * sweep, and the sweep is what backfills anyone the first call missed.
 *
 * Only for finished signups: a stub is an abandoned onboarding, and a
 * subscription for someone who never became a user is a Stripe object nobody
 * will ever reconcile.
 */
export async function startTrial(uid: string): Promise<StartTrialResult> {
  if (!stripeEnabled()) return { created: false, reason: 'stripe not configured' }
  const ref = adminDb().collection('users').doc(uid)
  const snap = await ref.get()
  if (!snap.exists) return { created: false, reason: 'no profile' }
  const profile = snap.data() as { email?: string; displayName?: string; onboardingComplete?: boolean; status?: string; billing?: Billing }

  if (profile.onboardingComplete !== true) return { created: false, reason: 'onboarding not complete' }
  if (profile.status === 'disabled') return { created: false, reason: 'account disabled' }
  if (profile.billing?.stripeCustomerId) return { created: false, reason: 'already has a subscription' }

  const s = stripe()
  const customer = await s.customers.create({
    email: profile.email ?? undefined,
    name: profile.displayName ?? undefined,
    // The ONLY link from a Stripe object back to a doctor. Every webhook reads
    // it; without it a subscription cannot be projected onto anyone.
    metadata: { uid },
  })
  const sub = await s.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId() }],
    trial_end: trialEndSeconds(),
    // When the trial ends with nothing on file, Stripe raises a real invoice and
    // moves the subscription to past_due. That is what the grace window and
    // Stripe's own dunning both hang off — 'cancel' would end the subscription
    // outright and 'pause' would strand it mid-trial with no invoice to pay.
    trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } },
    metadata: { uid },
  })

  await projectSubscription(sub.id)

  // The durable record. Lives outside users/{uid} because that document is
  // deleted when an account is, and the ATO wants these kept for five years.
  await adminDb().collection('billing_records').doc(uid).set({
    uid,
    email: profile.email ?? '',
    displayName: profile.displayName ?? '',
    stripeCustomerId: customer.id,
    subscriptionId: sub.id,
    createdAt: Date.now(),
  }, { merge: true })

  return { created: true, reason: 'trial started', customerId: customer.id, subscriptionId: sub.id }
}
