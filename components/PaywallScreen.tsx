'use client'

import { useRouter } from 'next/navigation'
import type { EntitlementState } from '@/lib/entitlement'

/**
 * Shown in place of the note-creating tabs when a subscription has lapsed.
 *
 * Blocks creating; never blocks reading. A doctor's notes are a clinical record
 * they may need at any moment — to answer a query about a prescription, or to
 * respond to a complaint — and holding those behind a payment prompt would be
 * indefensible whatever the invoice says. History, Patients and Export stay
 * open, so nothing written in LushNote is ever locked inside it.
 */
export default function PaywallScreen({ state }: { state: EntitlementState }) {
  const router = useRouter()

  const heading = state === 'paused' ? 'Your subscription is paused' : 'Your free trial has ended'

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-4">
      <div className="w-14 h-14 rounded-full bg-[var(--blue-lt)] border border-[var(--border)] flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </svg>
      </div>

      <h1 className="text-lg font-semibold text-[var(--text)]">{heading}</h1>

      <p className="text-sm text-[var(--text2)] max-w-sm">
        Creating and editing notes is paused until billing is set up. Your existing notes, patients and
        exports remain fully available — clinical records are never locked away.
      </p>

      <div className="flex flex-wrap gap-2 justify-center pt-1">
        <button
          onClick={() => router.push('/billing')}
          className="px-4 py-2 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium
                     motion-safe:transition-transform motion-safe:active:scale-95"
        >
          Set up billing
        </button>
        <button
          onClick={() => router.push('/history')}
          className="px-4 py-2 rounded-[var(--r)] border border-[var(--border)] text-[var(--text2)] text-sm font-medium
                     motion-safe:transition-transform motion-safe:active:scale-95"
        >
          Browse History
        </button>
      </div>

      <p className="text-xs text-[var(--text3)] max-w-sm pt-1">
        If you&apos;re rural or going through a tough financial period, reach out — cost will never be the
        reason you can&apos;t use LushNote.
      </p>
    </div>
  )
}
