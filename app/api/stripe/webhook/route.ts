import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { logToSink } from '@/lib/firestore/systemLogs'
import { withRequest, noteRequest } from '@/lib/requestContext'
import { stripe, stripeEnabled, projectSubscription, projectCustomer } from '@/lib/billing'

// Signature verification needs the EXACT bytes Stripe signed, so this handler
// must never parse the body first. Node runtime: the Stripe SDK's crypto and the
// Firebase Admin SDK both need it.
export const runtime = 'nodejs'

const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

/**
 * Has this event been handled already? Stripe retries for about three days, and
 * a retry of "subscription deleted" landing after a doctor has resubscribed
 * would be a real bug. `create` fails when the id exists, which makes the check
 * and the claim one atomic step — a plain read-then-write could let two
 * concurrent deliveries both pass.
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  try {
    await adminDb().collection('stripe_events').doc(event.id).create({
      type: event.type,
      created: event.created,
      processedAt: Date.now(),
      // The TTL field, and it holds an EXPIRY, not a creation time: Firestore
      // deletes a document once this instant is in the past. It must also be a
      // real Timestamp — a millisecond number is ignored by the policy, so the
      // collection would have grown forever while appearing to be managed.
      //
      // 30 days is well past Stripe's ~3-day retry window, so no retry can
      // arrive after its guard has been swept and be processed a second time.
      expiresAt: Timestamp.fromMillis(Date.now() + EVENT_TTL_MS),
    })
    return true
  } catch {
    return false
  }
}

/** The subscription this event concerns, however it happens to carry it. */
function subscriptionIdOf(object: Record<string, unknown>): string | null {
  const sub = object.subscription
  if (typeof sub === 'string') return sub
  if (sub && typeof sub === 'object' && 'id' in sub) return String((sub as { id: string }).id)
  // A subscription event's own object IS the subscription.
  if (object.object === 'subscription' && typeof object.id === 'string') return object.id
  return null
}

function customerIdOf(object: Record<string, unknown>): string | null {
  const c = object.customer
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && 'id' in c) return String((c as { id: string }).id)
  return null
}

/**
 * A BECS mandate is the bank's agreement, not the doctor's typing, and it can go
 * active days after the account number is entered — or fail outright. It is the
 * one piece of state the subscription refetch cannot see, so it is written here
 * and then read back by the projector.
 */
async function writeMandate(mandate: Stripe.Mandate, byCustomer?: string | null): Promise<void> {
  const users = adminDb().collection('users')
  // Prefer the payment method, which is exact. Fall back to the customer, which
  // is how the SetupIntent path finds the doctor before any mandate id is stored.
  const pmId = typeof mandate.payment_method === 'string' ? mandate.payment_method : mandate.payment_method?.id
  let snap = pmId ? await users.where('billing.paymentMethodId', '==', pmId).limit(1).get() : null
  if ((!snap || snap.empty) && byCustomer) {
    snap = await users.where('billing.stripeCustomerId', '==', byCustomer).limit(1).get()
  }
  if (!snap || snap.empty) return
  const status = mandate.status === 'active' ? 'active' : mandate.status === 'pending' ? 'pending' : 'none'
  await snap.docs[0].ref.set({
    billing: { mandateId: mandate.id, paymentMethodStatus: status, updatedAt: Date.now() },
  }, { merge: true })
  logToSink({ level: 'info', tag: 'billing', route: '/api/stripe/webhook', uid: snap.docs[0].id, message: `becs mandate ${mandate.status}` })
}

async function handle(event: Stripe.Event): Promise<void> {
  const object = event.data.object as unknown as Record<string, unknown>

  if (event.type === 'mandate.updated') {
    await writeMandate(event.data.object as Stripe.Mandate, customerIdOf(object))
    return
  }

  // A SetupIntent is where a payment method is born, and two things have to
  // happen that no refetch can infer. First, the method must become the
  // customer's default or the subscription will keep billing nothing. Second, a
  // BECS SetupIntent carries the mandate id — the only place it is handed to us
  // — and mandate.updated may well have arrived before the method existed to
  // match it against, so waiting for that event alone can strand a live mandate
  // showing as pending forever.
  if (event.type === 'setup_intent.succeeded') {
    const si = event.data.object as Stripe.SetupIntent
    const customerId = customerIdOf(object)
    if (!customerId) return
    const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
    if (pmId) {
      await stripe().customers.update(customerId, { invoice_settings: { default_payment_method: pmId } })
    }
    await projectCustomer(customerId)
    const mandateId = typeof si.mandate === 'string' ? si.mandate : si.mandate?.id
    if (mandateId) {
      const mandate = await stripe().mandates.retrieve(mandateId)
      await writeMandate(mandate, customerId)
    }
    return
  }

  if (event.type === 'charge.dispute.created') {
    // Deliberately no access change. A dispute is a conversation with a bank,
    // and cutting a doctor off mid-clinic over one would be the wrong reflex —
    // the admin decides. Logged at error level so it reaches Slack tonight.
    const customerId = customerIdOf(object)
    logToSink({
      level: 'error', tag: 'billing-dispute', route: '/api/stripe/webhook', status: 200,
      message: `dispute opened on customer ${customerId ?? 'unknown'} (${String(object.reason ?? 'no reason given')})`,
    })
    if (customerId) {
      const snap = await adminDb().collection('billing_records').where('stripeCustomerId', '==', customerId).limit(1).get()
      if (!snap.empty) await snap.docs[0].ref.set({ disputeOpenedAt: Date.now() }, { merge: true })
    }
    return
  }

  // Everything else resolves to a subscription and is projected from Stripe's
  // current state rather than from this event's payload.
  const subId = subscriptionIdOf(object)
  if (subId) { await projectSubscription(subId); return }

  // setup_intent.succeeded and payment_method.* carry a customer but no
  // subscription. The customer's subscription is what actually changed.
  const customerId = customerIdOf(object)
  if (customerId) await projectCustomer(customerId)
}

async function handlePOST(req: NextRequest) {
  if (!stripeEnabled() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ disabled: true })
  }

  const raw = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'no signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    // An unverifiable body is either a misconfigured secret or someone poking at
    // the endpoint. Never process it, and never 500 — 400 tells Stripe not to
    // bother retrying something that can't be fixed by retrying.
    logToSink({
      level: 'warn', tag: 'billing', route: '/api/stripe/webhook', status: 400,
      message: `signature verification failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
    })
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  noteRequest({ mode: event.type })

  if (!(await claimEvent(event))) {
    // Already handled. 200 so Stripe stops retrying.
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await handle(event)
  } catch (err) {
    // 500 asks Stripe to retry, which is right for a transient failure — the
    // event id is already claimed though, so release it or the retry will be
    // discarded as a duplicate and the state stays stale.
    await adminDb().collection('stripe_events').doc(event.id).delete().catch(() => {})
    logToSink({
      level: 'error', tag: 'billing', route: '/api/stripe/webhook', status: 500,
      message: `${event.type}: ${err instanceof Error ? err.message.slice(0, 250) : 'unknown'}`,
    })
    return NextResponse.json({ error: 'handler failed' }, { status: 500 })
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    logToSink({ level: 'info', tag: 'billing', route: '/api/stripe/webhook', message: event.type })
  }
  return NextResponse.json({ received: true })
}

export function POST(req: NextRequest) {
  return withRequest('/api/stripe/webhook', () => handlePOST(req))
}
