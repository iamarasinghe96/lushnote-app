'use client'

import { useEffect, useState } from 'react'

// Full-content-area overlay shown while a letter or hospital-form entry is being
// generated from a transcript. Notes reveal themselves via the typewriter, but
// letters/forms fill in one jump after a 1–2s wait, so without this the doctor
// stares at empty fields and wonders if anything is happening (and may switch
// tabs or refresh). This gives immediate, calm feedback and asks them to wait.
export function GeneratingOverlay({ noun = 'note' }: { noun?: string }) {
  const steps = ['Reading the transcript', `Writing your ${noun}`, 'Formatting the details']
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(v => Math.min(v + 1, steps.length - 1)), 1100)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-8 text-center no-print"
      style={{ background: 'rgba(248,250,252,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      role="status"
      aria-live="polite"
    >
      <svg width="44" height="44" viewBox="0 0 24 24" className="animate-spin motion-reduce:animate-none text-[var(--blue)]" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeOpacity="0.2" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <div>
        <div className="text-sm font-semibold text-[var(--text)] motion-safe:transition-opacity">{steps[i]}…</div>
        <div className="text-xs text-[var(--text3)] mt-1">This takes a few seconds — please stay on this screen.</div>
      </div>
    </div>
  )
}
