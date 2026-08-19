'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import { withTimeout } from '@/lib/utils'
import { resolveEntitlement, type EntitlementState } from '@/lib/entitlement'
import type { User } from '@/types'

const APP_URL = 'https://www.lushnote.com.au/'

interface SubscriptionPanelProps {
  profile: User
}

const STATE_CHIP: Record<EntitlementState, string> = {
  legacy: 'Active',
  exempt: 'Complimentary',
  trialing: 'Free trial',
  active: 'Active',
  grace: 'Payment needed',
  dunning: 'Payment processing',
  paused: 'Paused',
  paywalled: 'Paused',
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function SubscriptionPanel({ profile }: SubscriptionPanelProps) {
  const [linkCopied, setLinkCopied] = useState(false)
  const [price, setPrice] = useState('AUD $30/month')
  const billing = profile.billing
  const entitlement = resolveEntitlement(billing, Date.now())

  // The one price string, derived server-side from GST registration — so this
  // panel, the landing page and every email always agree.
  useEffect(() => {
    fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'public-config' }),
    })
      .then(r => r.json())
      .then((d: { price?: string; priceAu?: string }) => {
        setPrice((billing?.country === 'AU' ? d.priceAu : d.price) ?? 'AUD $30/month')
      })
      .catch(() => {})
  }, [billing?.country])

  const [feedbackText, setFeedbackText] = useState('')

  async function copyLink() {
    try {
      await withTimeout(navigator.clipboard.writeText(APP_URL))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  function shareEmail() {
    const subject = encodeURIComponent('You should try LushNote - AI clinical notes')
    const body = encodeURIComponent(
      `Hi,\n\nI've been using LushNote to generate clinical notes and it's been a real time-saver.\n\nYou can sign up for free at ${APP_URL}\n\nNo credit card needed - bring your own API key.\n\nBest`
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  function nativeShare() {
    if (typeof navigator === 'undefined' || !navigator.share) return
    navigator.share({ title: 'LushNote', text: 'AI-powered clinical note builder', url: APP_URL })
      .catch(() => undefined)
  }

  function sendFeedback() {
    if (!feedbackText.trim()) return
    const subject = encodeURIComponent('LushNote Feedback')
    const body = encodeURIComponent(feedbackText)
    window.open(`mailto:admin@lushnote.com.au?subject=${subject}&body=${body}`)
  }

  const hasShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div className="max-w-lg space-y-6">
      {/* Plan */}
      <div className="rounded-[var(--r-lg)] border border-[var(--blue)]/30 bg-[var(--blue-lt)] p-5">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="text-base font-semibold text-[var(--blue)]">Your LushNote subscription</h3>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/70 border border-[var(--blue)]/20 text-[var(--blue)]">
            {STATE_CHIP[entitlement.state]}
          </span>
        </div>

        {billing?.trialEndsAt && entitlement.state === 'trialing' && (
          <p className="text-sm text-[var(--text2)] mb-3">
            Your free trial runs until <strong>{formatDate(billing.trialEndsAt)}</strong>. No payment details are
            needed until then, and we&apos;ll remind you a week before.
          </p>
        )}
        {billing?.currentPeriodEnd && entitlement.state !== 'trialing' && (
          <p className="text-sm text-[var(--text2)] mb-3">
            {billing.cancelAtPeriodEnd || billing.paused ? 'Access continues until' : 'Renews'}{' '}
            <strong>{formatDate(billing.currentPeriodEnd)}</strong>.
          </p>
        )}

        <p className="text-sm text-[var(--text2)] mb-3">
          LushNote is three months free, then {price}. Cancel anytime and keep access to the end of the period
          you&apos;ve paid for. Card payments work worldwide; in Australia you can use direct debit instead. Your notes
          are always yours to export, whatever you decide.
        </p>
        <p className="text-xs text-[var(--text3)] mb-3">
          Prices are in Australian dollars. If your card is issued outside Australia, your bank converts the charge
          and may add a small foreign-transaction fee. You still bring your own Gemini or Groq key, so the AI runs on
          your own quota.
        </p>
        <p className="text-sm text-[var(--text2)] mb-4">
          If you&apos;re rural or going through a tough financial period, just reach out — we&apos;ll make sure cost
          is never the reason you can&apos;t use it.
        </p>

        <a href="/billing"
           className="inline-block px-4 py-2 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium">
          Manage billing
        </a>
      </div>

      {/* Share */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Share LushNote</h3>
        <p className="text-xs text-[var(--text2)] mb-3">
          Know a clinician who spends too long on notes? Share LushNote with them.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={shareEmail}>
            Share via email
          </Button>
          <Button variant="secondary" size="sm" onClick={copyLink}>
            {linkCopied ? 'Link copied!' : 'Copy app link'}
          </Button>
          {hasShare && (
            <Button variant="secondary" size="sm" onClick={nativeShare}>
              Share…
            </Button>
          )}
        </div>
      </section>

      {/* Feedback */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Send feedback</h3>
        <p className="text-xs text-[var(--text2)] mb-3">
          Feature requests, bug reports, or anything else - your feedback shapes LushNote.
        </p>
        <textarea
          value={feedbackText}
          onChange={e => setFeedbackText(e.target.value)}
          rows={4}
          placeholder="What would make LushNote better for you?"
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors resize-none mb-2"
        />
        <Button variant="secondary" size="sm" onClick={sendFeedback} disabled={!feedbackText.trim()}>
          Send feedback
        </Button>
      </section>

      {/* Legal */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-2">Legal</h3>
        <a
          href="/terms"
          className="flex items-center justify-between rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] hover:border-[var(--blue)]/50 transition-colors"
        >
          <span>Terms of Service &amp; Privacy Policy</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text3)]" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </a>
      </section>
    </div>
  )
}
