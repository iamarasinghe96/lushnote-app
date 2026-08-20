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

/**
 * Suspension and entitlement in ONE read, for routes that have no profile
 * loaded already. Everywhere the profile is in hand, call `resolveEntitlement`
 * on it directly instead — a second read of the same document buys nothing.
 */
export async function getAccessState(uid: string, now = Date.now()): Promise<{ suspended: boolean; entitlement: Entitlement }> {
  if (!uid) return { suspended: false, entitlement: { entitled: true, state: 'legacy', reason: 'no uid' } }
  try {
    const snap = await adminDb().collection('users').doc(uid).get()
    const data = snap.data() as { status?: string; billing?: Billing } | undefined
    return {
      suspended: data?.status === 'disabled',
      entitlement: resolveEntitlement(data?.billing, now),
    }
  } catch {
    // Never lock a clinician out because a read blipped.
    return { suspended: false, entitlement: { entitled: true, state: 'legacy', reason: 'billing read failed' } }
  }
}

// ── Consent, portal, pause ─────────────────────────────────────────────────

/** Bumped whenever the billing terms change. Recorded with each consent so an
 *  old authorisation can be read against the wording it was given under. */
export const TOS_VERSION = '2026-08-billing-v1'

/**
 * Record that a doctor authorised the charge. Written BEFORE the payment method
 * is confirmed, because the authorisation is what a bank asks to see in a
 * dispute and it must exist even if the confirmation then fails. Mirrored into
 * billing_records, which outlives the account.
 */
export async function recordConsent(uid: string, ip: string): Promise<{ acceptedAt: number; ip: string; tosVersion: string }> {
  const consent = { acceptedAt: Date.now(), ip: ip.slice(0, 45), tosVersion: TOS_VERSION }
  await adminDb().collection('users').doc(uid).set(
    { billing: { consent, updatedAt: Date.now() } }, { merge: true },
  )
  await adminDb().collection('billing_records').doc(uid).set({ consent }, { merge: true })
  return consent
}

async function customerIdFor(uid: string): Promise<string | null> {
  const snap = await adminDb().collection('users').doc(uid).get()
  return (snap.data()?.billing as Billing | undefined)?.stripeCustomerId ?? null
}

/**
 * A SetupIntent, not a PaymentIntent: nothing is charged now. `automatic_payment_methods`
 * lets Stripe decide what to offer from the customer's own location — a card
 * everywhere, and BECS Direct Debit for Australians. The Direct Debit Request
 * is presented and accepted inside Stripe's element, because a mandate has to
 * be given by the account holder and cannot be entered on their behalf.
 */
export async function createSetupIntent(uid: string): Promise<{ clientSecret: string | null }> {
  const customer = await customerIdFor(uid)
  if (!customer) return { clientSecret: null }
  const intent = await stripe().setupIntents.create({
    customer,
    usage: 'off_session',
    automatic_payment_methods: { enabled: true },
    metadata: { uid },
  })
  return { clientSecret: intent.client_secret }
}

/** Stripe's own portal for changing a card, cancelling, and reading invoices —
 *  it renders mandates and dunning state correctly, which a hand-built screen
 *  would have to keep chasing. */
export async function createPortalSession(uid: string, returnUrl: string): Promise<{ url: string | null }> {
  const customer = await customerIdFor(uid)
  if (!customer) return { url: null }
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: returnUrl })
  return { url: session.url }
}

/**
 * Pause and resume.
 *
 * `pause_collection` rather than cancelling: it keeps the subscription, the
 * payment method AND — for Australians — the BECS mandate, which is the whole
 * point of pausing rather than leaving. `behavior: 'void'` raises no invoices
 * while paused, and the period already paid for runs out on its own, which is
 * what ends access.
 */
export async function setPaused(uid: string, paused: boolean): Promise<{ paused: boolean } | null> {
  const snap = await adminDb().collection('users').doc(uid).get()
  const billing = snap.data()?.billing as Billing | undefined
  if (!billing?.subscriptionId) return null
  await stripe().subscriptions.update(billing.subscriptionId, {
    pause_collection: paused ? { behavior: 'void' } : null,
  })
  await projectSubscription(billing.subscriptionId)
  return { paused }
}

// ── Offboarding ────────────────────────────────────────────────────────────

/**
 * Close a doctor's billing when their account goes.
 *
 * Cancels the subscription and detaches the payment instrument — detaching a
 * BECS method also ends its mandate, so no bank authority is left standing
 * against an account that no longer exists.
 *
 * What it deliberately does NOT do: delete anything. The Stripe customer and
 * its invoices stay, and `billing_records/{uid}` is stamped rather than
 * removed, because the ATO requires five years of transaction and GST records
 * and that obligation outlives the doctor's decision to leave. It is also why
 * no code anywhere deletes from that collection.
 */
export async function stripeOffboard(uid: string): Promise<{ cancelled: boolean; detached: number }> {
  const out = { cancelled: false, detached: 0 }
  if (!stripeEnabled()) return out

  const snap = await adminDb().collection('users').doc(uid).get()
  const billing = snap.data()?.billing as Billing | undefined
  const customerId = billing?.stripeCustomerId
  if (!customerId) return out

  const s = stripe()

  if (billing?.subscriptionId) {
    // Immediate, not at period end: the account is going now, and leaving a
    // live subscription would bill someone who cannot use it.
    await s.subscriptions.cancel(billing.subscriptionId).catch(() => {})
    out.cancelled = true
  }

  for (const type of ['card', 'au_becs_debit'] as const) {
    const methods = await s.paymentMethods.list({ customer: customerId, type }).catch(() => null)
    for (const m of methods?.data ?? []) {
      await s.paymentMethods.detach(m.id).catch(() => {})
      out.detached++
    }
  }

  await adminDb().collection('billing_records').doc(uid).set({
    accountDeletedAt: Date.now(),
    subscriptionCancelled: out.cancelled,
    paymentMethodsDetached: out.detached,
  }, { merge: true })

  return out
}

// ── Australian turnover ────────────────────────────────────────────────────
//
// GST registration is compulsory once AUSTRALIAN turnover passes $75,000 in a
// rolling 12 months. Not global revenue — sales of services to overseas
// customers are GST-free exports and do not count towards it, which is exactly
// the distinction that makes a naive "total revenue" number dangerous here.
//
// Computed from Stripe's own paid invoices rather than a ledger of our own.
// Stripe is the system of record; a parallel tally would drift, and refunds and
// credit notes would have to be replayed into it by hand.

const AU_CUSTOMER_CACHE_LIMIT = 2000

/** Australian customers, by Stripe id, from what the webhook already projected. */
async function australianCustomerIds(): Promise<Set<string>> {
  const snap = await adminDb().collection('users')
    .where('billing.country', '==', 'AU')
    .limit(AU_CUSTOMER_CACHE_LIMIT)
    .get()
  const ids = new Set<string>()
  for (const d of snap.docs) {
    const id = (d.data()?.billing as Billing | undefined)?.stripeCustomerId
    if (id) ids.add(id)
  }
  return ids
}

export async function computeAuTurnover(now = Date.now()): Promise<NonNullable<BillingConfig['turnoverCache']>> {
  const since = Math.floor((now - 365 * 24 * 60 * 60 * 1000) / 1000)
  const auCustomers = await australianCustomerIds()
  const byMonth = new Map<string, number>()
  let total = 0

  // Paid invoices only: an invoice that was raised and never settled is not
  // turnover. Amounts come back in cents, already net of any credit note.
  for await (const inv of stripe().invoices.list({ status: 'paid', created: { gte: since }, limit: 100 })) {
    const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
    if (!customerId || !auCustomers.has(customerId)) continue
    const cents = inv.amount_paid ?? 0
    total += cents
    const month = new Date((inv.created ?? 0) * 1000).toISOString().slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + cents)
  }

  return {
    auTaxable12mCents: total,
    computedAt: now,
    byMonth: Array.from(byMonth.entries()).map(([month, cents]) => ({ month, cents })).sort((a, b) => a.month.localeCompare(b.month)),
  }
}

export async function saveTurnoverCache(cache: NonNullable<BillingConfig['turnoverCache']>): Promise<void> {
  await adminDb().collection('config').doc('billing').set(
    { turnoverCache: cache, updatedAt: Date.now() }, { merge: true },
  )
}

/**
 * Turn GST collection on or off.
 *
 * The price is NOT touched: `tax_behavior` is fixed at creation and cannot be
 * changed once a price has been used, so the amount stays AUD $30 and the GST
 * is carved out of it rather than added on top. What changes is a Stripe Tax
 * registration for Australia — with one, Australian invoices show the GST
 * component and become compliant tax invoices; without one, nothing is
 * collected from anybody. Overseas customers are unaffected either way, because
 * exports of services are GST-free.
 */
export async function setGstRegistered(registered: boolean, effectiveDate: string | null): Promise<BillingConfig> {
  const s = stripe()
  if (registered) {
    const existing = await s.tax.registrations.list({ status: 'active', limit: 100 }).catch(() => null)
    const alreadyAu = existing?.data.some(r => r.country === 'AU')
    if (!alreadyAu) {
      await s.tax.registrations.create({
        country: 'AU',
        country_options: { au: { type: 'standard' } },
        active_from: effectiveDate ? Math.floor(new Date(`${effectiveDate}T00:00:00`).getTime() / 1000) : 'now',
      })
    }
  } else {
    // Stripe does not delete a registration; it is expired, which preserves the
    // history of what was collected while it was live.
    const existing = await s.tax.registrations.list({ status: 'active', limit: 100 }).catch(() => null)
    for (const r of existing?.data ?? []) {
      if (r.country === 'AU') await s.tax.registrations.update(r.id, { expires_at: 'now' }).catch(() => {})
    }
  }

  const next: BillingConfig = {
    gstRegistered: registered,
    gstEffectiveDate: effectiveDate,
    gstInclusive: true,
    updatedAt: Date.now(),
  }
  await adminDb().collection('config').doc('billing').set(next, { merge: true })
  return next
}

// ── Pipeline health ────────────────────────────────────────────────────────
//
// The whole design rests on one chain: Stripe fires an event → the webhook
// verifies and refetches → the projection lands on users/{uid}.billing. Proving
// that chain works should never require opening a database console, so
// everything an admin would go looking for is answered here instead.

export type StripeMode = 'test' | 'live' | 'off'

export interface PipelineHealth {
  mode: StripeMode
  webhookConfigured: boolean
  priceConfigured: boolean
  /** Webhook deliveries this app actually processed, from the idempotency ledger. */
  events: { last24h: number; last7d: number; latestAt: number | null; latestType: string | null }
  /** How many doctors sit in each entitlement state right now. */
  cohorts: Record<string, number>
  lastSweep: { at: number; scanned: number; trialsStarted: number; paywalled: number; errors: number } | null
}

export function stripeMode(): StripeMode {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return 'off'
  return key.startsWith('sk_live_') ? 'live' : 'test'
}

export async function pipelineHealth(now = Date.now()): Promise<PipelineHealth> {
  const db = adminDb()
  const DAY = 24 * 60 * 60 * 1000

  // stripe_events is written once per delivery the webhook accepted, so counting
  // it answers "is Stripe actually reaching us" without trusting anything else.
  let last24h = 0, last7d = 0, latestAt: number | null = null, latestType: string | null = null
  try {
    const snap = await db.collection('stripe_events').orderBy('processedAt', 'desc').limit(500).get()
    for (const d of snap.docs) {
      const x = d.data() as { processedAt?: number; type?: string }
      const at = x.processedAt ?? 0
      if (latestAt === null) { latestAt = at; latestType = x.type ?? null }
      if (now - at <= DAY) last24h++
      if (now - at <= 7 * DAY) last7d++
    }
  } catch { /* an empty or unindexed collection is itself the answer: nothing yet */ }

  const cohorts: Record<string, number> = {}
  try {
    const snap = await db.collection('users').limit(5000).get()
    for (const d of snap.docs) {
      const data = d.data() as { onboardingComplete?: boolean; status?: string; billing?: Billing }
      // Stubs never get subscriptions, so counting them would only ever look
      // like a backlog that never clears.
      if (data.onboardingComplete !== true || data.status === 'disabled') continue
      const state = resolveEntitlement(data.billing, now).state
      cohorts[state] = (cohorts[state] ?? 0) + 1
    }
  } catch { /* leave empty rather than guess */ }

  const cfg = await db.collection('config').doc('billing').get().catch(() => null)
  const lastSweep = (cfg?.data()?.lastSweep as PipelineHealth['lastSweep']) ?? null

  return {
    mode: stripeMode(),
    webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
    priceConfigured: !!process.env.STRIPE_PRICE_ID,
    events: { last24h, last7d, latestAt, latestType },
    cohorts,
    lastSweep,
  }
}

export interface Reconciliation {
  found: boolean
  uid?: string
  email?: string
  stored: Partial<Billing> | null
  live: {
    customerId: string | null
    subscriptionId: string | null
    status: string | null
    trialEndsAt: number | null
    currentPeriodEnd: number | null
    cancelAtPeriodEnd: boolean | null
    paused: boolean | null
    defaultPaymentMethod: string | null
  } | null
  /** Fields where Firestore and Stripe disagree. Empty means the projection is current. */
  drift: string[]
  note: string
}

/**
 * Compare what we stored against what Stripe says right now, for one doctor.
 *
 * This is the check that used to mean opening a database console: if `drift` is
 * empty, the webhook chain is doing its job. Drift is not automatically a bug —
 * an event can be seconds behind — but drift that persists means the projection
 * has stopped.
 */
export async function reconcileUser(lookup: string): Promise<Reconciliation> {
  const db = adminDb()
  const term = lookup.trim()
  if (!term) return { found: false, stored: null, live: null, drift: [], note: 'No user given' }

  let doc = await db.collection('users').doc(term).get()
  if (!doc.exists) {
    const byEmail = await db.collection('users').where('email', '==', term).limit(1).get()
    if (byEmail.empty) return { found: false, stored: null, live: null, drift: [], note: 'No doctor with that uid or email' }
    doc = byEmail.docs[0]
  }

  const data = doc.data() as { email?: string; billing?: Billing }
  const stored = data.billing ?? null
  const base = { found: true, uid: doc.id, email: data.email ?? '' }

  if (!stored?.stripeCustomerId) {
    return { ...base, stored, live: null, drift: [], note: 'No subscription yet — nothing to compare' }
  }
  if (!stripeEnabled()) {
    return { ...base, stored, live: null, drift: [], note: 'Stripe is not configured in this environment' }
  }

  const s = stripe()
  let sub: Stripe.Subscription | null = null
  try {
    if (stored.subscriptionId) sub = await s.subscriptions.retrieve(stored.subscriptionId)
    else {
      const list = await s.subscriptions.list({ customer: stored.stripeCustomerId, status: 'all', limit: 1 })
      sub = list.data[0] ?? null
    }
  } catch {
    // The commonest cause by far, and worth naming rather than showing a blank:
    // a customer created in the other mode simply does not exist in this one.
    return {
      ...base, stored, live: null, drift: ['subscription unreadable'],
      note: `Stripe (${stripeMode()} mode) could not read this subscription. If the id was created in the other mode, that is expected.`,
    }
  }

  const customer = sub ? await s.customers.retrieve(stored.stripeCustomerId).catch(() => null) : null
  const defaultPm = customer && !('deleted' in customer && customer.deleted)
    ? unwrapId(customer.invoice_settings?.default_payment_method as string | { id: string } | null)
    : null

  const live: Reconciliation['live'] = sub ? {
    customerId: stored.stripeCustomerId,
    subscriptionId: sub.id,
    status: sub.status,
    trialEndsAt: sub.trial_end ? sub.trial_end * 1000 : null,
    currentPeriodEnd: sub.items?.data?.[0]?.current_period_end ? sub.items.data[0].current_period_end * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    paused: !!sub.pause_collection,
    defaultPaymentMethod: defaultPm,
  } : null

  const drift: string[] = []
  if (live) {
    if (stored.subscriptionStatus !== live.status) drift.push(`status: stored ${stored.subscriptionStatus} vs Stripe ${live.status}`)
    if ((stored.trialEndsAt ?? null) !== live.trialEndsAt) drift.push('trialEndsAt')
    if ((stored.currentPeriodEnd ?? null) !== live.currentPeriodEnd) drift.push('currentPeriodEnd')
    if (!!stored.cancelAtPeriodEnd !== live.cancelAtPeriodEnd) drift.push('cancelAtPeriodEnd')
    if (!!stored.paused !== live.paused) drift.push('paused')
    if ((stored.paymentMethodId ?? null) !== live.defaultPaymentMethod) drift.push('paymentMethod')
  } else {
    drift.push('no subscription in Stripe')
  }

  return {
    ...base, stored, live, drift,
    note: drift.length
      ? 'Firestore and Stripe disagree. Re-project to bring them into line.'
      : 'Firestore matches Stripe — the webhook chain is current.',
  }
}

/** Force a re-projection for one doctor: the repair for any drift found above. */
export async function reprojectUser(uid: string): Promise<boolean> {
  const snap = await adminDb().collection('users').doc(uid).get()
  const billing = snap.data()?.billing as Billing | undefined
  if (!billing?.stripeCustomerId) return false
  const result = billing.subscriptionId
    ? await projectSubscription(billing.subscriptionId)
    : await projectCustomer(billing.stripeCustomerId)
  return !!result
}
