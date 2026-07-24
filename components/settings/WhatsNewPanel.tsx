'use client'

import { useEffect, useState } from 'react'

interface Announcement { id: string; title: string; summary: string; details: string; version: string; publishedAt: number | null }

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// Render the details field: blank lines separate paragraphs; lines starting with
// "- " become a bullet list.
function Details({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  return (
    <div className="space-y-2 mt-2">
      {blocks.map((block, i) => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
        const bullets = lines.filter(l => l.startsWith('- '))
        if (bullets.length === lines.length && lines.length > 0) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1">
              {lines.map((l, j) => <li key={j} className="text-sm text-[var(--text2)]">{l.replace(/^- /, '')}</li>)}
            </ul>
          )
        }
        return <p key={i} className="text-sm text-[var(--text2)] whitespace-pre-wrap">{block}</p>
      })}
    </div>
  )
}

export default function WhatsNewPanel() {
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/whats-new')
      .then(r => r.json())
      .then(d => { if (!cancelled) setItems(d.announcements ?? []) })
      .catch(() => { if (!cancelled) setItems([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
    )
  }

  if (items.length === 0) {
    return <p className="text-sm text-[var(--text3)]">No updates yet. Check back soon.</p>
  }

  return (
    <div className="max-w-2xl space-y-4">
      {items.map(a => (
        <div key={a.id} className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[var(--text)]">{a.title}</h3>
            {a.version && <span className="text-[11px] text-[var(--blue)] bg-[var(--blue-lt)] rounded-full px-2 py-0.5">{a.version}</span>}
            <span className="text-[11px] text-[var(--text3)] ml-auto">{day(a.publishedAt)}</span>
          </div>
          <p className="text-sm text-[var(--text2)] mt-1">{a.summary}</p>
          {a.details.trim() && <Details text={a.details} />}
        </div>
      ))}
    </div>
  )
}
