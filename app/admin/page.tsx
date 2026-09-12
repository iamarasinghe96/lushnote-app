'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import type { ReactNode } from 'react'
import DashboardPanel from '@/components/admin/DashboardPanel'
import UsersPanel from '@/components/admin/UsersPanel'
import AnnouncementsPanel from '@/components/admin/AnnouncementsPanel'
import FeedbackPanel from '@/components/admin/FeedbackPanel'
import LetterheadsPanel from '@/components/admin/LetterheadsPanel'
import HospitalFormsPanel from '@/components/admin/HospitalFormsPanel'
import EmailsPanel from '@/components/admin/EmailsPanel'
import BillingPanel from '@/components/admin/BillingPanel'
import AppearancePanel from '@/components/admin/AppearancePanel'
import ReleasesPanel from '@/components/admin/ReleasesPanel'
import LogsPanel from '@/components/admin/LogsPanel'
import BackButton from '@/components/ui/BackButton'
import { SECTIONS, PINNED, OVERFLOW, isSectionKey, type SectionKey } from '@/lib/adminSections'

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

// Each entry takes the ?q= deep-link value so a section can open pre-filtered
// (Users hands a uid to Logs). Still one map — add a section by adding an entry
// here and in SECTIONS, nothing else.
const PANELS: Record<SectionKey, (q: string) => ReactNode> = {
  dashboard: () => <DashboardPanel />,
  users: () => <UsersPanel />,
  'whats-new': () => <AnnouncementsPanel />,
  feedback: () => <FeedbackPanel />,
  letterheads: () => <LetterheadsPanel />,
  forms: () => <HospitalFormsPanel />,
  emails: () => <EmailsPanel />,
  billing: () => <BillingPanel />,
  appearance: () => <AppearancePanel />,
  releases: () => <ReleasesPanel />,
  logs: q => <LogsPanel initialSearch={q} />,
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [section, setSection] = useState<SectionKey>('dashboard')
  const [deepLinkQuery, setDeepLinkQuery] = useState('')

  // The More menu, opened and closed the same way as the header user menu in
  // app/(app)/layout.tsx: a mounted flag that outlives `open` for the length of
  // the closing animation, released by a timer rather than onAnimationEnd. An
  // animation that is interrupted or never fires would otherwise leave an
  // invisible panel over the console swallowing clicks; pointer-events-none
  // covers that window either way.
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMounted, setMoreMounted] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const inOverflow = OVERFLOW.some(s => s.key === section)

  useEffect(() => {
    if (moreOpen) { setMoreMounted(true); return }
    if (!moreMounted) return
    const t = setTimeout(() => setMoreMounted(false), 140)
    return () => clearTimeout(t)
  }, [moreOpen, moreMounted])

  useEffect(() => {
    if (!moreOpen) return
    function onMouseDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  useEffect(() => {
    if (loading) return
    if (!user || user.uid !== ADMIN_UID) router.replace('/')
    else if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const s = params.get('section')
      if (s && isSectionKey(s)) setSection(s)
      setDeepLinkQuery(params.get('q') ?? '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user])

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[#10b981]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>
      </div>
    )
  }
  if (!user || user.uid !== ADMIN_UID) return null

  return (
    <div className="h-dvh overflow-y-auto overflow-x-hidden bg-[#f8fafc]">
      <header className="sticky top-0 z-30" style={{ background: 'linear-gradient(to right, #1d4ed8, #2563eb)', boxShadow: '0 2px 8px rgba(15,23,42,.12)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center gap-3 px-4" style={{ height: 52 }}>
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <div className="w-8 h-8 rounded-full bg-[#5ad6a7] flex items-center justify-center shrink-0"><span className="text-white text-xs font-bold select-none">LN</span></div>
            <span className="text-white font-semibold text-sm select-none truncate">Admin Console</span>
          </div>
          {/* Inline nav — the five pinned sections, then More */}
          <nav className="hidden sm:flex gap-1 flex-1 min-w-0 items-center">
            {PINNED.map(s => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-medium motion-safe:transition-colors ${
                  section === s.key ? 'bg-white text-[#1d4ed8]' : 'text-white/85 hover:bg-white/10'
                }`}
              >
                {s.label}
              </button>
            ))}

            <div ref={moreRef} className="relative shrink-0">
              <button
                onClick={() => setMoreOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className={`flex items-center gap-1 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-sm font-medium motion-safe:transition-colors ${
                  // The open section living inside More has to be visible from
                  // the closed button, or the console looks like nothing is
                  // selected while a panel is plainly on screen.
                  inOverflow ? 'bg-white text-[#1d4ed8]' : 'text-white/85 hover:bg-white/10'
                }`}
              >
                {inOverflow ? OVERFLOW.find(s => s.key === section)!.label : 'More'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden
                     className={`motion-safe:transition-transform ${moreOpen ? 'rotate-180' : ''}`}>
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {moreMounted && (
                <div
                  role="menu"
                  className={`absolute right-0 top-full mt-2 w-48 rounded-[var(--r)] border border-[var(--border)]
                              bg-white py-1 z-40 ${moreOpen ? '' : 'pointer-events-none'}`}
                  style={{
                    boxShadow: 'var(--shadow-lg)',
                    transformOrigin: 'top right',
                    animation: `${moreOpen ? 'menu-in' : 'menu-out'} 0.14s cubic-bezier(0.22,1,0.36,1) both`,
                  }}
                >
                  {OVERFLOW.map(s => (
                    <button
                      key={s.key}
                      role="menuitem"
                      onClick={() => { setSection(s.key); setMoreOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-sm motion-safe:transition-colors ${
                        section === s.key
                          ? 'text-[var(--blue)] font-medium bg-[var(--blue-lt)]'
                          : 'text-[var(--text2)] hover:bg-[var(--bg)] hover:text-[var(--text)]'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>
          <BackButton onClick={() => router.push('/generate')} label="Back to app" tone="onDark" className="ml-auto sm:ml-0 shrink-0 whitespace-nowrap" />
        </div>
        {/* Section navbar — second row, scrollable, mobile only */}
        <nav className="sm:hidden flex gap-1 px-3 pb-2 overflow-x-auto scrollbar-none">
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium motion-safe:transition-colors ${
                section === s.key ? 'bg-white text-[#1d4ed8]' : 'text-white/85 hover:bg-white/10'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {PANELS[section](deepLinkQuery)}
    </div>
  )
}
