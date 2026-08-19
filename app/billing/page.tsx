'use client'

// Deliberately OUTSIDE the (app) route group. A doctor whose subscription has
// lapsed is blocked from the note-creating tabs, and the one page they must
// still reach is the one that fixes that — so it cannot live behind the gate.
// It is also where the Stripe Customer Portal returns them.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { resolveEntitlement, type EntitlementState } from '@/lib/entitlement'

const CARD = 'rounded-2xl border border-[var(--border)] bg-white p-5'

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

export default function BillingPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const [price, setPrice] = useState<string>('AUD $30/month')

  useEffect(() => {
    if (!loading && !user) router.replace('/')
  }, [loading, user, router])

  // The price string is derived from GST registration server-side, so it is the
  // same string here, on the landing page and in every email.
  useEffect(() => {
    fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'public-config' }),
    })
      .then(r => r.json())
      .then((d: { price?: string; priceAu?: string }) => {
        const au = profile?.billing?.country === 'AU'
        setPrice((au ? d.priceAu : d.price) ?? 'AUD $30/month')
      })
      .catch(() => {})
  }, [profile?.billing?.country])

  if (loading || !profile) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--text3)]">Loading…</div>
  }

  const billing = profile.billing
  const entitlement = resolveEntitlement(billing, Date.now())
  const isTrial = entitlement.state === 'trialing'
  const hasMethod = billing?.paymentMethodStatus === 'active' || billing?.paymentMethodStatus === 'pending'

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="max-w-lg mx-auto space-y-4">

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-[var(--text)]">Billing</h1>
          <Link href="/generate" className="text-sm text-[var(--blue)]">← Back to LushNote</Link>
        </div>

        <div className={CARD + ' space-y-3'}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--text)]">{STATE_LABEL[entitlement.state]}</span>
            {entitlement.entitled
              ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Full access</span>
              : <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Note creation paused</span>}
          </div>

          <dl className="text-sm space-y-1">
            {isTrial && (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text2)]">Free trial ends</dt>
                <dd className="text-[var(--text)]">{formatDate(billing?.trialEndsAt)}</dd>
              </div>
            )}
            {!isTrial && billing?.currentPeriodEnd && (
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--text2)]">{billing.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}</dt>
                <dd className="text-[var(--text)]">{formatDate(billing.currentPeriodEnd)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text2)]">Price after trial</dt>
              <dd className="text-[var(--text)]">{price}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--text2)]">Payment method</dt>
              <dd className="text-[var(--text)]">
                {billing?.paymentMethodType === 'au_becs_debit'
                  ? (billing.paymentMethodStatus === 'active' ? 'Bank account (direct debit)' : 'Bank account — awaiting confirmation')
                  : billing?.paymentMethodType === 'card' ? 'Card'
                  : 'None yet'}
              </dd>
            </div>
          </dl>

          {!hasMethod && (
            <p className="text-xs text-[var(--text2)] pt-1">
              No payment details are needed during the trial. We&apos;ll remind you a week before it ends.
            </p>
          )}
        </div>

        <div className={CARD + ' space-y-2'}>
          <h2 className="text-sm font-semibold text-[var(--text)]">Payment details</h2>
          <p className="text-xs text-[var(--text2)]">
            Card payments worldwide, or direct debit from an Australian bank account. Prices are in Australian
            dollars — if your card is issued outside Australia, your bank converts the charge and may add a small
            foreign-transaction fee.
          </p>
          {/* The Payment Element, consent capture and Customer Portal arrive in
              the next layer. Saying so plainly beats a button that does nothing. */}
          <p className="text-xs text-[var(--text3)] pt-1">
            Adding payment details from this page is being switched on shortly. Nothing is charged until your
            trial ends, and we&apos;ll email you before then.
          </p>
        </div>

        <p className="text-xs text-[var(--text3)] text-center">
          Billed by Gaia Symbiosis. Questions? <a href="mailto:admin@lushnote.com.au" className="text-[var(--blue)]">admin@lushnote.com.au</a>
        </p>
      </div>
    </div>
  )
}
