'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Announcement { id: string; title: string; summary: string; version: string }

const SEEN_KEY = 'ln_whatsnew_seen'

// A one-time popup shown when a doctor arrives and the newest published
// announcement hasn't been seen on this device yet. Brief only — it links to the
// detailed What's New tab in Settings. The "seen" marker is an announcement id in
// localStorage (a UI preference, not patient data).
export default function WhatsNewPopup() {
  const router = useRouter()
  const [item, setItem] = useState<Announcement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/whats-new')
      .then(r => r.json())
      .then(d => {
        const latest = (d.announcements ?? [])[0] as Announcement | undefined
        if (!latest || cancelled) return
        let seen: string | null = null
        try { seen = localStorage.getItem(SEEN_KEY) } catch { /* ignore */ }
        if (seen !== latest.id) setItem(latest)
      })
      .catch(() => { /* silent — never block the app */ })
    return () => { cancelled = true }
  }, [])

  function dismiss() {
    if (item) { try { localStorage.setItem(SEEN_KEY, item.id) } catch { /* ignore */ } }
    setItem(null)
  }

  function seeMore() {
    dismiss()
    router.push('/settings?tab=whats-new')
  }

  if (!item) return null

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.4)' }}>
      <div
        className="w-full max-w-sm rounded-[var(--r-lg)] p-5 motion-safe:animate-[whatsnew-in_200ms_ease-out]"
        style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', boxShadow: '0 8px 30px rgba(15,23,42,.18)', border: '1px solid rgba(255,255,255,0.45)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--blue)] bg-[var(--blue-lt)] rounded-full px-2 py-0.5">What&rsquo;s new</span>
          {item.version && <span className="text-[11px] text-[var(--text3)]">{item.version}</span>}
        </div>
        <h3 className="text-base font-semibold text-[var(--text)] mt-2">{item.title}</h3>
        <p className="text-sm text-[var(--text2)] mt-1 leading-relaxed">{item.summary}</p>
        <div className="flex gap-2 mt-4">
          <button onClick={seeMore} className="flex-1 py-2.5 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium motion-safe:active:scale-[0.97] motion-safe:transition-transform">See what&rsquo;s new</button>
          <button onClick={dismiss} className="px-4 py-2.5 rounded-[var(--r)] border border-[var(--border)] text-sm text-[var(--text2)]">Dismiss</button>
        </div>
      </div>
    </div>
  )
}
