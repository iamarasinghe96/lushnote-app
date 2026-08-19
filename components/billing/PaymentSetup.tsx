'use client'

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { auth } from '@/lib/firebase'

// Loaded once per page, not per render — loadStripe fetches Stripe.js and doing
// it inside the component would refetch on every state change.
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken()
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` }
}

interface Props {
  /** Called after Stripe confirms, so the page can refresh its state. */
  onDone: () => void
  price: string
}

function SetupForm({ onDone, price }: Props) {
  const stripe = useStripe()
  const elements = useElements()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements || !agreed) return
    setBusy(true)
    setError(null)

    // The authorisation is recorded BEFORE confirming. It is what a bank asks
    // to see in a dispute, and it has to exist even if the confirmation then
    // fails or the doctor closes the tab mid-3DS.
    try {
      await fetch('/api/billing', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'record-consent' }),
      })
    } catch { /* the confirmation below is the thing that must not be blocked */ }

    const { error: err } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/billing?setup=complete` },
      // Only leaves the page when the bank demands it (3DS). Everything else
      // resolves here, so the doctor keeps their context.
      redirect: 'if_required',
    })

    setBusy(false)
    if (err) {
      setError(err.message ?? 'That did not go through. Please check the details and try again.')
      return
    }
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Stripe renders the card fields, and for Australian customers the BECS
          fields plus its own Direct Debit Request wording — a mandate has to be
          given by the account holder, so it cannot be reproduced here. */}
      <PaymentElement options={{ layout: 'tabs' }} />

      <label className="flex gap-2.5 items-start text-xs text-[var(--text2)] cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--blue)]"
        />
        <span>
          I accept the <a href="/terms" target="_blank" rel="noreferrer" className="text-[var(--blue)] underline">Terms of Service</a>{' '}
          and authorise Gaia Symbiosis to charge my card, or debit my account under the Direct Debit Request,
          {' '}{price} after my free trial ends, until I cancel.
        </span>
      </label>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <button
        type="submit"
        disabled={!stripe || !agreed || busy}
        className="w-full px-4 py-2.5 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium
                   disabled:opacity-50 disabled:cursor-not-allowed
                   motion-safe:transition-transform motion-safe:active:scale-[0.98]"
      >
        {busy ? 'Saving…' : 'Save payment details'}
      </button>

      <p className="text-[11px] text-[var(--text3)]">
        Nothing is charged today. LushNote never sees or stores your card or bank numbers — they go straight to Stripe.
      </p>
    </form>
  )
}

export default function PaymentSetup({ onDone, price }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/billing', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ action: 'setup-intent' }),
        })
        const data = await res.json() as { clientSecret?: string | null }
        if (!cancelled) {
          if (data.clientSecret) setClientSecret(data.clientSecret)
          else setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!stripePromise) {
    return <p className="text-xs text-[var(--text3)]">Payments are not switched on in this environment.</p>
  }
  if (failed) {
    return <p className="text-xs text-[var(--danger)]">Could not start the payment form. Please reload and try again.</p>
  }
  if (!clientSecret) {
    return <p className="text-xs text-[var(--text3)]">Loading payment form…</p>
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: { colorPrimary: '#2563eb', borderRadius: '12px', fontFamily: 'Inter, system-ui, sans-serif' },
        },
      }}
    >
      <SetupForm onDone={onDone} price={price} />
    </Elements>
  )
}
