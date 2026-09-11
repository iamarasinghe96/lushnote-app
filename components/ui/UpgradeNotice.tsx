'use client'

import { useRouter } from 'next/navigation'

// Shown once a doctor's Gemini day is spent.
//
// It is deliberately NOT an error. The note they asked for arrived — LushNote's
// own Groq key generated it — so this explains a change the doctor may not have
// noticed rather than reporting a failure. Wording follows the house rule for
// notifications: say what happened and what to do, not why the app works the
// way it does.
//
// It never appears mid-recording. Transcription falls back silently because the
// worst possible moment to sell somebody something is while they are sitting
// with a patient; this waits until a note is in their hands.

interface Props {
  onDismiss: () => void
}

export function UpgradeNotice({ onDismiss }: Props) {
  const router = useRouter()

  return (
    <div
      className="mx-4 mt-3 rounded-[var(--r-lg)] border border-[#10b981]/40 p-4"
      style={{
        background: 'rgba(255,255,255,0.75)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
      }}
      role="status"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[#059669]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M10 2c.35 3.4 1 5.65 2.15 6.85S15.6 10.65 19 11c-3.4.35-5.65 1-6.85 2.15S10.35 16.6 10 20c-.35-3.4-1-5.65-2.15-6.85S4.4 11.35 1 11c3.4-.35 5.65-1 6.85-2.15S9.65 5.4 10 2Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text)]">Free Gemini limit reached for today</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--text2)]">
            Your notes are still being written — LushNote is covering them. Upgrade for
            higher limits that do not run out mid-clinic.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/billing')}
              className="rounded-[var(--r)] bg-[#10b981] px-3 py-1.5 text-xs font-medium text-white
                         hover:bg-[#059669] motion-safe:transition-colors motion-safe:active:scale-[0.97]"
              style={{ willChange: 'transform' }}
            >
              Upgrade to Pro
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-[var(--r)] px-3 py-1.5 text-xs font-medium text-[var(--text2)]
                         hover:bg-[var(--bg)] motion-safe:transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
