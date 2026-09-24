import type { ReactNode } from 'react'

export const PRIMARY_CTA =
  'inline-flex items-center justify-center px-4 py-2 rounded-full bg-[#10b981] text-white text-sm font-semibold ' +
  'hover:bg-[#059669] whitespace-nowrap motion-safe:transition-colors'

export const PRIMARY_CTA_LARGE = PRIMARY_CTA.replace('px-4 py-2', 'px-6 py-3').replace('text-sm', 'text-base')

export const SECONDARY_CTA =
  'inline-flex items-center justify-center px-6 py-3 rounded-full border border-[var(--border)] bg-white text-[var(--text)] ' +
  'text-base font-medium hover:border-[var(--blue)]/50 whitespace-nowrap motion-safe:transition-colors'

export function PageIntro({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <header className="mb-10">
      <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] leading-tight">{title}</h1>
      {lead && <p className="mt-3 text-lg text-[var(--text2)] leading-relaxed">{lead}</p>}
    </header>
  )
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">{children}</div>
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-semibold text-[var(--text)] mb-3">{title}</h2>
      <div className="space-y-3 text-[var(--text2)] leading-relaxed">{children}</div>
    </section>
  )
}

/** Copy the owner still has to write. Visible on purpose, so an unfinished page
 *  is obvious on the preview rather than quietly shipped empty. */
export function Todo({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--r)] border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong>TODO:</strong> {children}
    </p>
  )
}
