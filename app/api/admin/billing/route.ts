import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink, writeAudit } from '@/lib/firestore/systemLogs'
import {
  getBillingConfig, setGstRegistered, computeAuTurnover, saveTurnoverCache,
  stripeEnabled, PRICE_AUD, GST_THRESHOLD_AUD, priceString,
  pipelineHealth, reconcileUser, reprojectUser,
} from '@/lib/billing'
import { runBillingSweep } from '@/lib/firestore/billingSweep'

// Admin billing surface. Reads aggregates and identifiers only — never a card,
// a bank number, a mandate id or a consent IP, in keeping with the privacy wall
// the rest of the admin console holds to.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'overview' | 'setGst' | 'setExempt' | 'refreshTurnover' | 'recordsExport' | 'health' | 'reconcile' | 'reproject' | 'runSweep'
      lookup?: string
      registered?: boolean
      effectiveDate?: string | null
      uid?: string
      exempt?: boolean
    }

    let actor
    try { actor = await requireAdmin(req) } catch { return unauthorized() }
    const db = adminDb()

    if (body.action === 'overview') {
      const cfg = await getBillingConfig()
      const cache = cfg.turnoverCache
      const auCents = cache?.auTaxable12mCents ?? 0
      return NextResponse.json({
        configured: stripeEnabled(),
        config: cfg,
        priceAud: PRICE_AUD,
        thresholdAud: GST_THRESHOLD_AUD,
        priceOverseas: priceString(cfg.gstRegistered, false),
        priceAu: priceString(cfg.gstRegistered, true),
        turnover: {
          auTaxable12mAud: auCents / 100,
          // Against the AU threshold only. Overseas sales are GST-free exports
          // and do not count towards it — reporting global revenue here would
          // trigger registration years early.
          percentOfThreshold: Math.round((auCents / 100 / GST_THRESHOLD_AUD) * 100),
          computedAt: cache?.computedAt ?? null,
          byMonth: cache?.byMonth ?? [],
        },
      })
    }

    if (body.action === 'health') {
      return NextResponse.json(await pipelineHealth())
    }

    if (body.action === 'reconcile') {
      return NextResponse.json(await reconcileUser(body.lookup ?? ''))
    }

    if (body.action === 'reproject') {
      if (!body.uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
      const ok = await reprojectUser(body.uid)
      await writeAudit({ actorUid: actor.uid, action: 'billing.reproject', targetUid: body.uid, meta: { ok } })
      return NextResponse.json({ success: ok })
    }

    if (body.action === 'runSweep') {
      // The same work the 23:00 UTC cron does. Idempotent, so running it by hand
      // to see the result changes nothing a second run would undo.
      const result = await runBillingSweep()
      await writeAudit({ actorUid: actor.uid, action: 'billing.runSweep', meta: { ...result } })
      return NextResponse.json({ sweep: result })
    }

    if (body.action === 'refreshTurnover') {
      if (!stripeEnabled()) return NextResponse.json({ error: 'Stripe is not configured' }, { status: 400 })
      const cache = await computeAuTurnover()
      await saveTurnoverCache(cache)
      return NextResponse.json({ turnover: cache })
    }

    if (body.action === 'setGst') {
      if (!stripeEnabled()) return NextResponse.json({ error: 'Stripe is not configured' }, { status: 400 })
      const registered = body.registered === true
      const effectiveDate = body.effectiveDate ?? null
      if (registered && effectiveDate && !ISO_DATE.test(effectiveDate)) {
        return NextResponse.json({ error: 'Effective date must be YYYY-MM-DD' }, { status: 400 })
      }
      const cfg = await setGstRegistered(registered, effectiveDate)
      await writeAudit({ actorUid: actor.uid, action: 'billing.setGst', meta: { registered, effectiveDate } })
      logToSink({ level: 'info', tag: 'billing', route: '/api/admin/billing', message: `GST registration ${registered ? 'enabled' : 'disabled'}` })
      return NextResponse.json({ config: cfg })
    }

    if (body.action === 'setExempt') {
      const { uid, exempt } = body
      if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
      await db.collection('users').doc(uid).set(
        { billing: { billingExempt: exempt === true, updatedAt: Date.now() } }, { merge: true },
      )
      await writeAudit({ actorUid: actor.uid, action: 'billing.setExempt', targetUid: uid, meta: { exempt: exempt === true } })
      return NextResponse.json({ success: true, exempt: exempt === true })
    }

    if (body.action === 'recordsExport') {
      // Includes deleted accounts by design — that is the whole reason the
      // collection outlives users/{uid}.
      const snap = await db.collection('billing_records').limit(5000).get()
      const rows = snap.docs.map(d => {
        const x = d.data()
        return [
          d.id,
          x.email ?? '',
          x.displayName ?? '',
          x.stripeCustomerId ?? '',
          x.subscriptionId ?? '',
          x.country ?? '',
          x.consent?.acceptedAt ? new Date(x.consent.acceptedAt).toISOString() : '',
          x.consent?.tosVersion ?? '',
          x.createdAt ? new Date(x.createdAt).toISOString() : '',
          x.accountDeletedAt ? new Date(x.accountDeletedAt).toISOString() : '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      })
      const csv = ['uid,email,displayName,stripeCustomerId,subscriptionId,country,consentAcceptedAt,tosVersion,createdAt,accountDeletedAt', ...rows].join('\n')
      await writeAudit({ actorUid: actor.uid, action: 'billing.recordsExport', meta: { rows: rows.length } })
      return new NextResponse(csv, {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="lushnote-billing-records.csv"' },
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    logToSink({ level: 'error', tag: 'admin/billing', route: '/api/admin/billing', message: msg.slice(0, 300), status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
