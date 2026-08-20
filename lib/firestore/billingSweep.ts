// The two billing transitions no webhook can deliver.
//
// Stripe tells us when something happens. It has no event for "the grace window
// ran out and nothing happened", and none for "this doctor finished onboarding
// while the billing route was failing" — both are absences, and an absence
// fires nothing. They are swept nightly instead.
//
// Everything here is idempotent: the sweep runs every night forever, and a
// second pass over the same doctor must change nothing.

import { adminDb } from '@/lib/firebase-admin'
import { logToSink } from '@/lib/firestore/systemLogs'
import { startTrial, stripeEnabled, computeAuTurnover, saveTurnoverCache } from '@/lib/billing'
import type { Billing } from '@/lib/entitlement'

/** Bounded so one night's sweep cannot run past the function's deadline. The
 *  rest are picked up tomorrow; nothing here is time-critical to the hour. */
const MAX_BACKFILL_PER_RUN = 50
const SCAN_LIMIT = 5000

export interface SweepResult {
  scanned: number
  trialsStarted: number
  paywalled: number
  errors: number
}

interface Row {
  uid: string
  onboardingComplete?: boolean
  status?: string
  billing?: Billing
}

export async function runBillingSweep(now = Date.now()): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, trialsStarted: 0, paywalled: 0, errors: 0 }
  if (!stripeEnabled()) return result

  const snap = await adminDb().collection('users').limit(SCAN_LIMIT).get()
  const rows: Row[] = snap.docs.map(d => ({ uid: d.id, ...(d.data() as Omit<Row, 'uid'>) }))
  result.scanned = rows.length

  for (const row of rows) {
    if (row.status === 'disabled') continue

    // ── Grace expiry ────────────────────────────────────────────────────
    // Checked before the backfill so a doctor who needs paywalling tonight is
    // paywalled tonight, and the email that follows in the same cron run is
    // about the state they are actually in.
    const b = row.billing
    if (b && !b.paywalledAt && !b.billingExempt
        && b.gracePeriodEnd && b.gracePeriodEnd < now
        && b.paymentMethodStatus === 'none') {
      try {
        await adminDb().collection('users').doc(row.uid).set({
          billing: { paywalledAt: now, updatedAt: now },
        }, { merge: true })
        result.paywalled++
        logToSink({ level: 'info', tag: 'billing', route: '/api/lifecycle', uid: row.uid, message: 'grace expired — paywalled' })
      } catch {
        result.errors++
      }
      continue
    }

    // ── Backfill ────────────────────────────────────────────────────────
    // A finished signup with no subscription. Covers the onboarding call
    // failing, and is also how every existing doctor gets their trial when
    // this goes live.
    if (row.onboardingComplete === true && !row.billing?.stripeCustomerId) {
      if (result.trialsStarted >= MAX_BACKFILL_PER_RUN) continue
      try {
        const started = await startTrial(row.uid)
        if (started.created) result.trialsStarted++
      } catch (err) {
        result.errors++
        logToSink({
          level: 'warn', tag: 'billing', route: '/api/lifecycle', uid: row.uid,
          message: `backfill failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        })
      }
    }
  }

  // Recomputed whole, every night, from Stripe's own invoices — so refunds and
  // credit notes are reflected without anything having to replay them.
  try {
    await saveTurnoverCache(await computeAuTurnover(now))
  } catch (err) {
    result.errors++
    logToSink({
      level: 'warn', tag: 'billing', route: '/api/lifecycle',
      message: `turnover refresh failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
    })
  }

  // Recorded, not just logged: the admin panel needs to answer "did the cron run
  // last night" without anyone reading a log.
  try {
    await adminDb().collection('config').doc('billing').set({
      lastSweep: { at: now, ...result },
    }, { merge: true })
  } catch { /* the sweep's real work is already done */ }

  if (result.trialsStarted || result.paywalled || result.errors) {
    logToSink({
      level: result.errors ? 'warn' : 'info', tag: 'billing', route: '/api/lifecycle',
      message: `sweep: ${result.scanned} scanned, ${result.trialsStarted} trials started, ${result.paywalled} paywalled, ${result.errors} errors`,
    })
  }
  return result
}
