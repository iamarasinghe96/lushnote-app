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

export interface SweepRow {
  uid: string
  onboardingComplete?: boolean
  status?: string
  billing?: Billing
}

export type SweepAction = 'skip' | 'paywall' | 'backfill'

/**
 * What this row needs tonight. Pure, so the rule can be tested without a
 * database — every clause here is a decision that either takes a doctor's
 * access away or spends a Stripe write, and both are worth pinning down.
 *
 * Paywalling is checked BEFORE the backfill so a doctor whose grace ran out is
 * paywalled tonight, and the lifecycle email that follows in the same cron run
 * is about the state they are actually in.
 */
export function sweepAction(row: SweepRow, now: number): SweepAction {
  if (row.status === 'disabled') return 'skip'

  const b = row.billing
  if (b && !b.paywalledAt && !b.billingExempt
      && b.gracePeriodEnd && b.gracePeriodEnd < now
      && b.paymentMethodStatus === 'none') return 'paywall'

  // Paywalling is terminal as far as the sweep is concerned. Without this a
  // paywalled row that had lost its customer id would fall into the backfill
  // below and be handed a fresh trial — the one way this sweep could give back
  // access it had just taken away.
  if (b?.paywalledAt) return 'skip'

  // A finished signup with no Stripe customer. Covers the onboarding call
  // failing, and is also how every existing doctor gets their trial when this
  // goes live. Keyed on the customer id rather than the presence of a billing
  // map, because consent can be recorded before the customer exists.
  if (row.onboardingComplete === true && !b?.stripeCustomerId) return 'backfill'
  return 'skip'
}

export async function runBillingSweep(now = Date.now()): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, trialsStarted: 0, paywalled: 0, errors: 0 }
  if (!stripeEnabled()) return result

  const snap = await adminDb().collection('users').limit(SCAN_LIMIT).get()
  const rows: SweepRow[] = snap.docs.map(d => ({ uid: d.id, ...(d.data() as Omit<SweepRow, 'uid'>) }))
  result.scanned = rows.length

  for (const row of rows) {
    const action = sweepAction(row, now)
    if (action === 'skip') continue

    if (action === 'paywall') {
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
    // Every attempt failing is a configuration fault, not a bad night: error
    // level so it reaches Slack instead of sitting in a list nobody opens.
    const systemic = result.errors > 0 && result.trialsStarted === 0
    logToSink({
      level: systemic ? 'error' : result.errors ? 'warn' : 'info', tag: 'billing', route: '/api/lifecycle',
      message: `sweep: ${result.scanned} scanned, ${result.trialsStarted} trials started, ${result.paywalled} paywalled, ${result.errors} errors`,
    })
  }
  return result
}
