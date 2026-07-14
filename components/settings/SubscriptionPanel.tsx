'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import { withTimeout } from '@/lib/utils'
import type { User } from '@/types'

const APP_URL = 'https://lushnote.app'

interface SubscriptionPanelProps {
  profile: User
}

export default function SubscriptionPanel({ profile: _profile }: SubscriptionPanelProps) {
  const [linkCopied, setLinkCopied] = useState(false)
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
    window.open(`mailto:iamarasinghe96@gmail.com?subject=${subject}&body=${body}`)
  }

  const hasShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div className="max-w-lg space-y-6">
      {/* Plan */}
      <div className="rounded-[var(--r-lg)] border border-[var(--blue)]/30 bg-[var(--blue-lt)] p-5">
        <h3 className="text-base font-semibold text-[var(--blue)] mb-3">LushNote is free to use</h3>
        <p className="text-sm text-[var(--text2)] mb-3">
          LushNote is free, and we intend to keep it that way for as long as we can. You bring your
          own Gemini or Groq API key, giving you direct access to powerful AI models at minimal cost.
          The whole point is to make a doctor&apos;s day easier so they can spend more time with patients.
        </p>
        <p className="text-sm text-[var(--text2)] mb-3">
          We won&apos;t introduce a subscription unless we genuinely need to - to cover our own running
          costs, nothing more. And if that day comes, it&apos;ll be a small, fair fee, never a cash grab.
        </p>
        <p className="text-sm text-[var(--text2)]">
          If you&apos;re rural or going through a tough financial period, just reach out - we&apos;ll make sure
          cost is never the reason you can&apos;t use it.
        </p>
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
    </div>
  )
}
