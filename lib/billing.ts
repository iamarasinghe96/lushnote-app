// Everything that knows Stripe exists lives here or in the two /api/stripe and
// /api/billing routes. The rest of the app consumes only the neutral `billing`
// map on the user doc and the pure resolver in lib/entitlement.ts — so if we
// ever move to a merchant of record, this file is replaced and the app is not.
//
// Server only: imports firebase-admin and reads STRIPE_SECRET_KEY.

import Stripe from 'stripe'
import { adminDb } from '@/lib/firebase-admin'
import { resolveEntitlement, type Billing, type Entitlement } from '@/lib/entitlement'

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
