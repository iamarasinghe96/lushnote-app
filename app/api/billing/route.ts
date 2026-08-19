import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'
import { withRequest, noteRequest } from '@/lib/requestContext'
import {
  startTrial, stripeEnabled, getBillingConfig, priceString, PRICE_AUD, TRIAL_MONTHS,
  createSetupIntent, createPortalSession, recordConsent, setPaused, stripeOffboard, TOS_VERSION,
} from '@/lib/billing'
import { adminDb } from '@/lib/firebase-admin'
import { resolveEntitlement, type Billing } from '@/lib/entitlement'

// The one authenticated billing surface: start a trial, report state, open a
// SetupIntent, record the authorisation, hand off to Stripe's portal, pause and
// resume. Nothing here ever sees a card or bank number — the Payment Element
// sends those straight to Stripe.

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action?: 'start-trial' | 'public-config' | 'state' | 'setup-intent' | 'record-consent' | 'portal' | 'pause' | 'resume' | 'offboard-self'
      returnUrl?: string
    }
    noteRequest({ mode: body.action ?? 'billing' })

    // The price and GST state are on the landing page, which nobody is signed in
    // to. Nothing here is sensitive: it is the same string printed on the site.
    if (body.action === 'public-config') {
      const cfg = await getBillingConfig()
      return NextResponse.json({
        gstRegistered: cfg.gstRegistered,
        priceAud: PRICE_AUD,
        trialMonths: TRIAL_MONTHS,
        price: priceString(cfg.gstRegistered, false),
        priceAu: priceString(cfg.gstRegistered, true),
      })
    }

    let uid: string
    try { uid = await requireUser(req) } catch { return unauthorized() }
    noteRequest({ uid })

    // Absent Stripe keys means monetization is not switched on in this
    // environment. Say so plainly rather than failing — the app is expected to
    // run without them.
    if (!stripeEnabled()) return NextResponse.json({ disabled: true })

    if (body.action === 'start-trial') {
      const result = await startTrial(uid)
      // Only a genuine creation is worth a line; "already has one" is the
      // expected answer every time the sweep re-checks a doctor.
      if (result.created) {
        logToSink({ level: 'info', tag: 'billing', route: '/api/billing', uid, message: `trial started (${result.subscriptionId})` })
      }
      return NextResponse.json(result)
    }

    if (body.action === 'state') {
      const snap = await adminDb().collection('users').doc(uid).get()
      const billing = snap.data()?.billing as Billing | undefined
      const cfg = await getBillingConfig()
      return NextResponse.json({
        billing: billing ?? null,
        entitlement: resolveEntitlement(billing, Date.now()),
        price: priceString(cfg.gstRegistered, billing?.country === 'AU'),
        tosVersion: TOS_VERSION,
      })
    }

    if (body.action === 'setup-intent') {
      return NextResponse.json(await createSetupIntent(uid))
    }

    if (body.action === 'record-consent') {
      // Behind Vercel and Cloudflare the client address is the FIRST hop of
      // x-forwarded-for; every entry after it is a proxy. Recorded for dispute
      // defence and nothing else.
      const forwarded = req.headers.get('x-forwarded-for') ?? ''
      const ip = forwarded.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
      const consent = await recordConsent(uid, ip)
      logToSink({ level: 'info', tag: 'billing', route: '/api/billing', uid, message: `consent recorded (${consent.tosVersion})` })
      return NextResponse.json({ consent })
    }

    if (body.action === 'portal') {
      const returnUrl = typeof body.returnUrl === 'string' && body.returnUrl.startsWith('http')
        ? body.returnUrl
        : `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lushnote.com.au'}/billing`
      return NextResponse.json(await createPortalSession(uid, returnUrl))
    }

    if (body.action === 'pause' || body.action === 'resume') {
      const paused = body.action === 'pause'
      const result = await setPaused(uid, paused)
      if (!result) return NextResponse.json({ error: 'No subscription to change' }, { status: 400 })
      logToSink({ level: 'info', tag: 'billing', route: '/api/billing', uid, message: paused ? 'subscription paused' : 'subscription resumed' })
      return NextResponse.json(result)
    }

    if (body.action === 'offboard-self') {
      // The client deletes its own Firestore data but cannot reach Stripe — the
      // secret key is server-side. Called just before that deletion so the
      // subscription and mandate are closed while the ids are still readable.
      // The admin cascade does the same thing and remains the backstop.
      const result = await stripeOffboard(uid)
      logToSink({ level: 'info', tag: 'billing', route: '/api/billing', uid, message: `offboarded (cancelled=${result.cancelled}, detached=${result.detached})` })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    logToSink({ level: 'error', tag: 'billing', route: '/api/billing', message: msg.slice(0, 300), status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export function POST(req: NextRequest) {
  return withRequest('/api/billing', () => handlePOST(req))
}
