'use client'

// The card that holds the seam.
//
// Stopping a recording used to hand a doctor three things in a row: an inline
// spinner on the recording screen, then that screen unmounting, then - on the
// one-tap path - a navigation to /generate with the bare page on screen while it
// worked out what to do. Nothing owned the gap between the two, which is exactly
// the moment a doctor most wants to know the consultation is safe.
//
// So this is one card, held up across all of it by whoever outlives the
// navigation (the FAB), and taken down only when the next window is really
// there.

export function ProgressOverlay({ label }: { label: string }) {
  return (
    <div
      // Above the tab bar (99), modals (100) and the recording screen (110):
      // while this is up it is deliberately covering everything.
      className="fixed inset-0 z-[115] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-xs rounded-2xl bg-white px-8 py-10 flex flex-col items-center gap-6 shadow-xl">
        {/* Stills under reduced motion, the same trade GeneratingOverlay makes:
            the ring stops and the label carries the message on its own. */}
        <svg width="64" height="64" viewBox="0 0 48 48" className="animate-spin motion-reduce:animate-none" aria-hidden>
          <circle cx="24" cy="24" r="19" fill="none" stroke="#e2e8f0" strokeWidth="5" />
          <path
            d="M24 5a19 19 0 0 1 19 19"
            fill="none"
            stroke="var(--blue)"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-base font-semibold text-[var(--text)] text-center">{label}</p>
      </div>
    </div>
  )
}

/** The one place this wording lives, so every path that finishes a recording
 *  says the same thing. */
export const FINISHING_TRANSCRIPT = 'Finishing your transcript'
