'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProfile } from '@/lib/firestore/profiles'
import { duePrompt, isProState, resolveEntitlement } from '@/lib/entitlement'
import { allowanceResetsOn, fairUseOf } from '@/lib/fairUse'
import { monthKey } from '@/lib/utils'
import type { User } from '@/types'

/**
 * The in-app half of the payment reminders. Fires on or AFTER the threshold
 * rather than on the day, so a doctor who was on leave when the trial ended
 * still meets it the next time they open LushNote.
 *
 * Dismissal is stored on the profile, not in localStorage: a doctor who waves
 * this away on the ward computer should not meet it again on their phone.
 */
export default function BillingBanner({ profile, uid }: { profile: User; uid: string }) {
  const router = useRouter()
  const [hidden, setHidden] = useState(false)

  const prompt = duePrompt(profile.billing, Date.now())
  if (hidden) return null
  // A payment prompt outranks fair use: it is the one that can stop note-taking.
  if (!prompt || profile.billingPrompts?.[prompt]) return <FairUseNotice profile={profile} uid={uid} onHide={() => setHidden(true)} />

  const trialEnd = profile.billing?.trialEndsAt
    ? new Date(profile.billing.trialEndsAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })
    : null

  const message =
    prompt === 'paywalled'
      ? 'Note creation is paused. Add your payment details to restore access - your notes stay available either way.'
      // A bounced payment, which is the one case where details already exist
      // and are the problem. Says what to do rather than what went wrong; the
      // billing page carries the bank's actual reason.
      : prompt === 'paymentFailed'
        ? 'Your last payment did not go through. Update your payment details this week to keep creating notes.'
      : prompt === 'trialReminderDue'
        ? 'Your free trial has ended. Add your payment details this week to keep creating notes.'
        : `Your free trial ends${trialEnd ? ` on ${trialEnd}` : ' in a week'}. Add your payment details to keep going.`

  function dismiss() {
    setHidden(true)
    // Best-effort: a failed write only means they see it once more.
    void updateProfile(uid, { billingPrompts: { ...(profile.billingPrompts ?? {}), [prompt!]: Date.now() } }).catch(() => {})
  }

  return (
    <div
      role="status"
      className="mx-4 mb-2 rounded-[var(--r)] border border-amber-200 bg-amber-50 px-4 py-2.5
                 flex items-center gap-3 flex-wrap"
    >
      <p className="text-xs text-amber-900 flex-1 min-w-[200px]">{message}</p>
      <button
        onClick={() => router.push('/app/billing')}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--blue)] text-white
                   motion-safe:transition-transform motion-safe:active:scale-95"
      >
        Set up billing
      </button>
      <button onClick={dismiss} className="text-xs text-amber-800/70 px-1" aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  )
}

/**
 * Once a month, when this month's fair-use allowance is used. Dismissed for
 * the rest of that month only - next month it is a new allowance and, if it is
 * used again, a new thing to know.
 */
function FairUseNotice({ profile, uid, onHide }: { profile: User; uid: string; onHide: () => void }) {
  const router = useRouter()
  const month = monthKey()
  const fairUse = fairUseOf({ aiCost: profile.aiCost, billing: profile.billing, month })
  const onPaidPlan = isProState(resolveEntitlement(profile.billing, Date.now()).state)
  const dismissedAt = profile.billingPrompts?.fairUse
  if (!onPaidPlan || fairUse.level !== 'exceeded') return null
  if (dismissedAt && monthKey(new Date(dismissedAt)) === month) return null

  function dismiss() {
    onHide()
    void updateProfile(uid, { billingPrompts: { ...(profile.billingPrompts ?? {}), fairUse: Date.now() } }).catch(() => {})
  }

  return (
    <div
      role="status"
      className="mx-4 mb-2 rounded-[var(--r)] border border-amber-200 bg-amber-50 px-4 py-2.5
                 flex items-center gap-3 flex-wrap"
    >
      <p className="text-xs text-amber-900 flex-1 min-w-[200px]">
        This month&apos;s fair-use AI allowance is used. Until {allowanceResetsOn(month)} your AI runs on your own key.
        Nothing is blocked.
      </p>
      <button
        onClick={() => router.push('/app/billing')}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--blue)] text-white
                   motion-safe:transition-transform motion-safe:active:scale-95"
      >
        See options
      </button>
      <button onClick={dismiss} className="text-xs text-amber-800/70 px-1" aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  )
}
