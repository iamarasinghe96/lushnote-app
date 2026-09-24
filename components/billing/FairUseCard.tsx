'use client'

import { useState } from 'react'
import { allowanceResetsOn, type FairUse } from '@/lib/fairUse'

// The doctor's side of fair use: how much of this month's AI allowance is
// used, what happens past it, and the way out for a practice - Enterprise.
//
// Worded for the doctor who is simply busy as much as for the practice sharing
// one login. The app cannot tell the two apart and must not sound as if it
// has decided which one they are.

const CARD = 'rounded-2xl border border-[var(--border)] bg-white p-5'

interface Props {
  fairUse: FairUse
  /** On a paid plan, i.e. LushNote's key is what the allowance is spent on. */
  paid: boolean
  hasOwnGeminiKey: boolean
  busy: boolean
  onEnterprise: (on: boolean) => void
}

export default function FairUseCard({ fairUse, paid, hasOwnGeminiKey, busy, onEnterprise }: Props) {
  const [accepted, setAccepted] = useState(false)
  // Shown unasked once the allowance is close; otherwise one tap away, so it is
  // never hidden from a practice that already knows it needs it.
  const [showEnterprise, setShowEnterprise] = useState(false)
  const resets = allowanceResetsOn(fairUse.month)
  const percent = Math.min(100, Math.round(fairUse.share * 100))

  if (fairUse.enterprise) {
    return (
      <div className={CARD + ' space-y-2'}>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-[var(--text)]">AI usage</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--blue-lt)] text-[var(--blue)] border border-[var(--blue)]/20">Enterprise</span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text2)]">
          Your AI runs on your organisation&apos;s own Gemini API key, and Google bills your organisation directly for
          what you use. There is no fair-use allowance to watch. Your LushNote subscription is unchanged and covers
          everything else. If your key is missing or stops working, LushNote&apos;s free fallback keeps you going.
        </p>
        <button onClick={() => { if (window.confirm('Return to the standard plan? LushNote\'s key will serve your AI again, up to the monthly fair-use allowance.')) onEnterprise(false) }}
          disabled={busy}
          className="text-xs text-[var(--text2)] underline disabled:opacity-50">
          Return to the standard plan
        </button>
      </div>
    )
  }

  // Not on a paid plan: the AI already runs on their own key, so there is no
  // allowance being spent and nothing to say here.
  if (!paid) return null

  const offerOpen = showEnterprise || fairUse.level !== 'within'

  return (
    <div className={CARD + ' space-y-3'}>
      <h2 className="text-sm font-semibold text-[var(--text)]">AI usage this month</h2>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-[var(--text2)]">Fair-use allowance used</span>
          <span className="font-semibold text-[var(--text)]">{percent}%</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--border)] overflow-hidden" aria-hidden>
          <div className={`h-full rounded-full ${fairUse.level === 'exceeded' ? 'bg-amber-500' : fairUse.level === 'approaching' ? 'bg-amber-400' : 'bg-[#10b981]'}`}
               style={{ width: `${percent}%` }} />
        </div>
      </div>

      {fairUse.level === 'exceeded' ? (
        <div className="rounded-[var(--r)] border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-1">
          <p className="text-sm font-semibold text-amber-900">This month&apos;s allowance is used</p>
          <p className="text-xs leading-relaxed text-amber-800">
            Until {resets}, your AI runs on your own Gemini key, or LushNote&apos;s free fallback if you have not added
            one. Nothing is blocked and your notes are unaffected, but you may meet Google&apos;s free daily limit. If you
            need more, Enterprise below removes the limit.
          </p>
        </div>
      ) : fairUse.level === 'approaching' ? (
        <p className="text-xs leading-relaxed text-amber-800">
          You are close to this month&apos;s allowance. Past it, your AI runs on your own key until {resets}.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-[var(--text2)]">
          Your subscription includes AI on LushNote&apos;s keys, up to a fair-use allowance each month that matches what
          the subscription pays for. One clinician rarely comes near it. It starts again on {resets}.
        </p>
      )}

      {!offerOpen ? (
        <button onClick={() => setShowEnterprise(true)} className="text-xs text-[var(--blue)] underline">
          Using LushNote heavily, or across a practice? See Enterprise
        </button>
      ) : (
        <div className="rounded-[var(--r)] border border-[var(--border)] px-3 py-3 space-y-2">
          <p className="text-sm font-semibold text-[var(--text)]">Enterprise</p>
          <p className="text-xs leading-relaxed text-[var(--text2)]">
            For practices and heavy use. Your subscription stays exactly as it is, and the AI runs on your
            organisation&apos;s own Gemini API key, with billing turned on in Google Cloud. Google bills your organisation
            directly for what you use, at Google&apos;s own rates, on top of your LushNote subscription. There is no
            fair-use allowance, and AI requests are made under your organisation&apos;s agreement with Google.
          </p>
          {!hasOwnGeminiKey ? (
            <p className="text-xs leading-relaxed text-[var(--text2)]">
              First save your organisation&apos;s Gemini key in{' '}
              <a href="/settings?tab=api-keys" className="text-[var(--blue)] underline">Settings, API Keys</a>, then come back here.
            </p>
          ) : (
            <>
              <label className="flex items-start gap-2 text-xs text-[var(--text2)]">
                <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-0.5" />
                <span>
                  I understand that my organisation pays Google for this account&apos;s AI usage, on top of the LushNote
                  subscription, under the <a href="/terms" className="text-[var(--blue)] underline">terms</a>.
                </span>
              </label>
              <button onClick={() => onEnterprise(true)} disabled={busy || !accepted}
                className="px-4 py-2 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium disabled:opacity-50
                           motion-safe:transition-transform motion-safe:active:scale-[0.97]">
                {busy ? 'Moving…' : 'Move to Enterprise'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
