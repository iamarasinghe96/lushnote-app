'use client'

// Deliberately OUTSIDE the (app) route group. A doctor whose subscription has
// lapsed is blocked from the note-creating tabs, and the one page they must
// still reach is the one that fixes that — so it cannot live behind the gate.
// It is also where the Stripe Customer Portal returns them.

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/hooks/useAuth'
import PaymentSetup from '@/components/billing/PaymentSetup'
import type { Billing, Entitlement, EntitlementState } from '@/lib/entitlement'

const CARD = 'rounded-2xl border border-[var(--border)] bg-white p-5'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--text2)]">{label}</dt>
      <dd className="text-[var(--text)] text-right">{value}</dd>
    </div>
  )
}

function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

const STATE_LABEL: Record<EntitlementState, string> = {
  legacy: 'Active',
  exempt: 'Complimentary',
  trialing: 'Free trial',
  active: 'Active',
  grace: 'Payment needed',
  dunning: 'Payment processing',
  paused: 'Paused',
  paywalled: 'Paused — payment needed',
}

interface State {
  billing: Billing | null
  entitlement: Entitlement
  price: string
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch('/api/billing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<T>
}

function BillingInner() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useSearchParams()
  const [state, setState] = useState<State | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setState(await call<State>({ action: 'state' })) } catch { /* the card just stays as it was */ }
  }, [])

  useEffect(() => { if (!loading && !user) router.replace('/') }, [loading, user, router])
  useEffect(() => { if (user) void refresh() }, [user, refresh])

  // Returning from a 3DS challenge. Stripe's confirmation and our webhook race,
  // so re-read after a moment rather than showing a stale "no payment method".
  useEffect(() => {
    if (params.get('setup') !== 'complete') return
    setToast('Payment details saved.')
    const t = setTimeout(() => void refresh(), 1500)
    return () => clearTimeout(t)
  }, [params, refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Same call onboarding makes, and the nightly sweep after it. Idempotent and
  // guarded server-side, so pressing it twice cannot make two subscriptions.
  async function startTrial() {
    setBusy(true)
    try {
      await call({ action: 'start-trial' })
      await refresh()
      setToast('Free trial started.')
    } catch { setToast('Could not start the trial. Please try again.') }
    finally { setBusy(false) }
  }

  async function openPortal() {
    setBusy(true)
    const r = await call<{ url?: string | null }>({ action: 'portal', returnUrl: `${window.location.origin}/billing` })
    setBusy(false)
    if (r.url) window.location.href = r.url
    else setToast('Could not open the billing portal.')
  }

  async function togglePause(paused: boolean) {
    setBusy(true)
    await call({ action: paused ? 'pause' : 'resume' })
    await refresh()
    setBusy(false)
    setToast(paused ? 'Subscription paused.' : 'Subscription resumed.')
  }

  if (loading || !state) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text3)]">Loading…</div>
  }

  const b = state.billing
  const st = state.entitlement.state
  const isTrial = st === 'trialing'
  const hasMethod = b?.paymentMethodStatus === 'active' || b?.paymentMethodStatus === 'pending'

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="max-w-lg mx-auto space-y-4">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[var(--text)]">Billing</h1>
          <Link href="/generate" className="text-sm text-[var(--blue)]">← Back to LushNote</Link>
        </div>

        {toast && (
          <div className="rounded-[var(--r)] bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-2">{toast}</div>
        )}

        <div className={CARD + ' space-y-3'}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--text)]">{STATE_LABEL[st]}</span>
            {state.entitlement.entitled
              ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Full access</span>
              : <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Note creation paused</span>}
          </div>

          <dl className="text-sm space-y-1">
            {/* Shown whenever a trial exists, not only while it is running — a
                doctor who has just moved onto a paid month still wants to see
                when the free part ended. */}
            {b?.trialEndsAt && (
              <Row label={isTrial ? 'Free trial ends' : 'Free trial ended'} value={formatDate(b.trialEndsAt)} />
            )}
            {b?.currentPeriodEnd && (
              <Row
                label={b.cancelAtPeriodEnd || b.paused ? 'Access ends' : isTrial ? 'First charge' : 'Next charge'}
                value={formatDate(b.currentPeriodEnd)}
              />
            )}
            {b?.gracePeriodEnd && !hasMethod && (
              <Row label="Add details by" value={formatDate(b.gracePeriodEnd)} />
            )}
            {b?.paywalledAt && <Row label="Paused since" value={formatDate(b.paywalledAt)} />}
            <Row label={isTrial ? 'Price after trial' : 'Price'} value={state.price} />
            <Row
              label="Payment method"
              value={
                b?.paymentMethodType === 'au_becs_debit'
                  ? (b.paymentMethodStatus === 'active' ? 'Bank account (direct debit)' : 'Bank account — awaiting bank confirmation')
                  : b?.paymentMethodType === 'card' ? 'Card'
                  : 'None yet'
              }
            />
            {b?.country && <Row label="Billing country" value={b.country} />}
          </dl>

          {!b && (
            <p className="text-xs text-[var(--text2)]">
              Your subscription hasn&apos;t been set up yet — your account predates billing, so nothing has been
              scheduled and nothing is owed. Start your free trial below whenever you like; it also starts on its own
              overnight.
            </p>
          )}
          {b?.cancelAtPeriodEnd && (
            <p className="text-xs text-[var(--text2)]">
              Cancelled. You keep full access until {formatDate(b.currentPeriodEnd)}, and nothing further is charged.
            </p>
          )}
          {!hasMethod && isTrial && (
            <p className="text-xs text-[var(--text2)]">
              No payment details are needed during the trial. We&apos;ll remind you a week before it ends.
            </p>
          )}
        </div>

        <div className={CARD + ' space-y-3'}>
          <h2 className="text-sm font-semibold text-[var(--text)]">
            {!b ? 'Start your free trial' : hasMethod ? 'Change payment details' : 'Add payment details'}
          </h2>
          <p className="text-xs text-[var(--text2)]">
            Card payments worldwide, or direct debit from an Australian bank account. Prices are in Australian
            dollars — if your card is issued outside Australia, your bank converts the charge and may add a small
            foreign-transaction fee.
          </p>

          {!b ? (
            <button onClick={startTrial} disabled={busy}
              className="px-4 py-2 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium disabled:opacity-50">
              {busy ? 'Starting…' : 'Start my free trial'}
            </button>
          ) : adding || !hasMethod ? (
            <PaymentSetup price={state.price} onDone={() => { setAdding(false); setToast('Payment details saved.'); void refresh() }} />
          ) : (
            <button onClick={() => setAdding(true)} disabled={busy}
              className="px-4 py-2 rounded-[var(--r)] border border-[var(--border)] text-sm text-[var(--text2)] disabled:opacity-50">
              Replace payment method
            </button>
          )}
        </div>

        {b?.subscriptionId && (
          <div className={CARD + ' space-y-3'}>
            <h2 className="text-sm font-semibold text-[var(--text)]">Manage subscription</h2>
            <div className="flex flex-wrap gap-2">
              <button onClick={openPortal} disabled={busy}
                className="px-4 py-2 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium disabled:opacity-50">
                Invoices &amp; cancellation
              </button>
              {b.paused ? (
                <button onClick={() => togglePause(false)} disabled={busy}
                  className="px-4 py-2 rounded-[var(--r)] border border-[var(--border)] text-sm text-[var(--text2)] disabled:opacity-50">
                  Resume subscription
                </button>
              ) : (
                <button onClick={() => togglePause(true)} disabled={busy}
                  className="px-4 py-2 rounded-[var(--r)] border border-[var(--border)] text-sm text-[var(--text2)] disabled:opacity-50">
                  Pause subscription
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--text3)]">
              Pausing stops future charges and keeps your details and your notes. Access continues until the end of
              the period you&apos;ve already paid for, and resumes the moment you un-pause. Cancelling works the same
              way — you keep access to the end of the paid period.
            </p>
          </div>
        )}

        <p className="text-xs text-[var(--text3)] text-center">
          Billed by Gaia Symbiosis. Questions? <a href="mailto:admin@lushnote.com.au" className="text-[var(--blue)]">admin@lushnote.com.au</a>
        </p>
      </div>
    </div>
  )
}

export default function BillingPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-[var(--text3)]">Loading…</div>}>
      <BillingInner />
    </Suspense>
  )
}
