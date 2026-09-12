'use client'

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { auth } from '@/lib/firebase'
import { keyModeMismatch } from '@/lib/stripeKeyMode'

// Loaded once per page, not per render — loadStripe fetches Stripe.js and doing
// it inside the component would refetch on every state change.
//
// The catch matters: loadStripe REJECTS when the script cannot be fetched, and
// the only thing awaiting this promise is <Elements>, so an uncaught rejection
// would land in the console and nowhere a doctor can see it. Resolving to null
// leaves useStripe() null, which the stall timer below already reports.
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).catch(() => null)
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
  // `stripe` stays null while Stripe.js is still arriving, and FOREVER if it
  // never does — a blocked script, a key Stripe rejects. The two look identical
  // for the first second, so only the second one is worth reporting: without
  // this the doctor sees a tick-box and a button that can never be pressed, and
  // nothing on the page says why.
  const [stripeStalled, setStripeStalled] = useState(false)
  useEffect(() => {
    if (stripe) { setStripeStalled(false); return }
    const t = setTimeout(() => setStripeStalled(true), 8000)
    return () => clearTimeout(t)
  }, [stripe])

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

    const { error: err, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/billing?setup=complete` },
      // Only leaves the page when the bank demands it (3DS). Everything else
      // resolves here, so the doctor keeps their context.
      redirect: 'if_required',
    })

    if (err) {
      setBusy(false)
      setError(err.message ?? 'That did not go through. Please check the details and try again.')
      return
    }

    // Project it now rather than waiting on the webhook, or the page re-reads a
    // record that still says no payment method and puts the form straight back
    // up. Best-effort: the webhook is the guarantee, this is only the wait.
    if (setupIntent?.id) {
      try {
        await fetch('/api/billing', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ action: 'confirm-setup', setupIntentId: setupIntent.id }),
        })
      } catch { /* the webhook still lands; onDone re-reads either way */ }
    }

    setBusy(false)
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

      {/* This said an ad-blocker WAS the cause, and the first time it appeared it
          was wrong: the app's own Content-Security-Policy was refusing
          js.stripe.com, which looks identical from here. Nothing in the browser
          can tell a blocked script from a refused one, so the copy now reports
          what happened and offers the action, rather than naming a culprit it
          cannot actually identify. */}
      {stripeStalled && !error && (
        <p className="rounded-[var(--r)] bg-amber-50 border border-amber-200 px-3 py-2 text-xs leading-relaxed text-amber-800">
          The payment form did not load. Reload the page to try again. If it still
          does not appear, something in the browser is blocking
          <span className="font-medium"> js.stripe.com</span>, usually an extension
          or a privacy setting.
        </p>
      )}

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
        Nothing is charged today. LushNote never sees or stores your card or bank numbers - they go straight to Stripe.
      </p>
    </form>
  )
}

export default function PaymentSetup({ onDone, price }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [mismatch, setMismatch] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/billing', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ action: 'setup-intent' }),
        })
        const data = await res.json() as { clientSecret?: string | null; mode?: string; error?: string }
        if (!cancelled) {
          // Checked BEFORE the secret is used: a mixed pair renders an empty
          // Payment Element and puts the only real complaint in the console,
          // where a doctor will never see it.
          setMismatch(keyModeMismatch(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, data.mode))
          if (data.clientSecret) setClientSecret(data.clientSecret)
          // The server already knows exactly why and says so in `error`. Throwing
          // that away and printing "please reload" cost real time twice: a CSP
          // that blocked Stripe, and a payment method the account had not
          // activated. Reloading fixes neither, and the page was the only place
          // anybody was looking.
          else setFailed(data.error ?? 'unknown')
        }
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : 'unknown')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!stripePromise) {
    return (
      <p className="text-xs text-[var(--text3)]">
        Payments are not switched on in this environment. If this is production,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing from the build. It must be a Config
        variable, not a Secret, or it never reaches the browser.
      </p>
    )
  }
  if (mismatch) {
    return <p className="rounded-[var(--r)] bg-amber-50 border border-amber-200 px-3 py-2 text-xs leading-relaxed text-amber-800">{mismatch}</p>
  }
  if (failed) {
    return (
      <div className="rounded-[var(--r)] bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
        <p className="text-xs font-medium text-amber-900">The payment form could not be started.</p>
        <p className="text-xs leading-relaxed text-amber-800">
          Reload to try again. If it keeps happening, send this line to
          {' '}<a href="mailto:admin@lushnote.com.au" className="underline">admin@lushnote.com.au</a> and
          it will be fixed at our end, not yours.
        </p>
        <p className="text-[11px] font-mono text-amber-900/80 break-words">{failed}</p>
      </div>
    )
  }
  if (!clientSecret) {
    return <p className="text-xs text-[var(--text3)]">Loading payment form…</p>
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        // Matched to components/ui/Input: 12px radius, --border, solid white,
        // --text on --text3 placeholders, and the same blue focus ring.
        //
        // What this CANNOT reach is the Country list once it is open. Stripe's
        // country field is a native <select>, so the closed control is drawn in
        // their iframe and the open list is drawn by the OPERATING SYSTEM - the
        // same split CLAUDE.md documents as the reason components/ui/Select
        // exists. Our Select cannot be substituted here either: the field lives
        // in a cross-origin iframe, which is precisely what keeps the card
        // number out of this page. So the closed control matches and the open
        // list stays the OS's.
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#2563eb',
            colorText: '#0f172a',
            colorTextSecondary: '#475569',
            colorTextPlaceholder: '#94a3b8',
            colorDanger: '#dc2626',
            borderRadius: '12px',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSizeBase: '14px',
            spacingUnit: '4px',
          },
          rules: {
            '.Input': {
              border: '1px solid #e2e8f0',
              boxShadow: 'none',
              padding: '10px 12px',
            },
            '.Input:focus': {
              border: '1px solid #2563eb',
              boxShadow: '0 0 0 2px rgba(59,130,246,0.10)',
            },
            '.Input--invalid': {
              border: '1px solid #dc2626',
              boxShadow: 'none',
            },
            '.Tab': {
              border: '1px solid #e2e8f0',
              boxShadow: 'none',
            },
            '.Tab--selected': {
              border: '1px solid #2563eb',
              boxShadow: '0 0 0 2px rgba(59,130,246,0.10)',
            },
            '.Label': {
              color: '#475569',
              fontWeight: '500',
            },
          },
        },
      }}
    >
      <SetupForm onDone={onDone} price={price} />
    </Elements>
  )
}
