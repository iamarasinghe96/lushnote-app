'use client'

import { useRouter } from 'next/navigation'

// Shown when a doctor's free Gemini day is spent.
//
// It is NOT an error and NOT a paywall. The note they asked for arrived —
// LushNote's own key carried it — so this exists only to explain a change they
// may not have noticed, and to mention that there is a way to avoid it.
//
// The tone is the requirement, not a preference. A doctor reading this is
// between patients and nothing is blocking them; anything that reads as urgency
// would be manufacturing pressure over a problem that is already handled. It
// says what happened, that it is fine, what the trade-off is, and leaves.
//
// It appears twice in a three-month trial, a fortnight apart, and never again —
// see `shouldShowUpgradeNotice`. It is never shown mid-recording.

interface Props {
  onDismiss: () => void
}

export function UpgradeNotice({ onDismiss }: Props) {
  const router = useRouter()

  return (
    <div
      className="mx-4 mt-3 rounded-[var(--r-lg)] border border-[var(--border)] p-4"
      style={{
        background: 'rgba(255,255,255,0.75)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
      }}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[var(--text3)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text)]">
            You&rsquo;ve used today&rsquo;s free Gemini quota
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text2)]">
            That&rsquo;s fine, your notes keep generating and nothing stops. They&rsquo;re now written by
            the backup model, so the wording may not be quite as polished as your last one.
            If you&rsquo;d like to keep that quality, Pro removes the daily limit. No rush.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/billing')}
              className="rounded-[var(--r)] border border-[var(--blue)] px-3 py-1.5 text-xs font-medium
                         text-[var(--blue)] hover:bg-[var(--blue-lt)]
                         motion-safe:transition-colors motion-safe:active:scale-[0.97]"
              style={{ willChange: 'transform' }}
            >
              See Pro
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-[var(--r)] px-3 py-1.5 text-xs font-medium text-[var(--text3)]
                         hover:bg-[var(--bg)] hover:text-[var(--text2)] motion-safe:transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
