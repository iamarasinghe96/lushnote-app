import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'
import { withRequest, noteRequest } from '@/lib/requestContext'
import { startTrial, stripeEnabled, getBillingConfig, priceString, PRICE_AUD, TRIAL_MONTHS } from '@/lib/billing'

// Layer 2 surface: start a trial, and report what a doctor's billing state is.
// The payment-capture actions (setup-intent, consent, portal, pause) arrive with
// the /billing page in Layer 4.

async function handlePOST(req: NextRequest) {
  try {
    const body = await req.json() as { action?: 'start-trial' | 'public-config' }
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
