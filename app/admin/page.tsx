'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import type { ReactNode } from 'react'
import UsersPanel from '@/components/admin/UsersPanel'
import LetterheadsPanel from '@/components/admin/LetterheadsPanel'
import HospitalFormsPanel from '@/components/admin/HospitalFormsPanel'
import LogsPanel from '@/components/admin/LogsPanel'

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

// One admin console for every managed resource. Add a section by adding an entry
// here AND a panel in PANELS below — nav, deep-link and render all derive from
// SECTIONS, so there are no other spots to touch.
const SECTIONS = [
  { key: 'users', label: 'Users' },
  { key: 'letterheads', label: 'Letterheads' },
  { key: 'forms', label: 'Hospital Forms' },
  { key: 'logs', label: 'Logs & Errors' },
] as const
type SectionKey = (typeof SECTIONS)[number]['key']

const PANELS: Record<SectionKey, ReactNode> = {
  users: <UsersPanel />,
  letterheads: <LetterheadsPanel />,
  forms: <HospitalFormsPanel />,
  logs: <LogsPanel />,
}

export default function AdminPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [section, setSection] = useState<SectionKey>('users')

  useEffect(() => {
    if (loading) return
    if (!user || user.uid !== ADMIN_UID) router.replace('/')
    else if (typeof window !== 'undefined') {
      const s = new URLSearchParams(window.location.search).get('section')
      if (s && SECTIONS.some(sec => sec.key === s)) setSection(s as SectionKey)
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
    <div className="h-dvh overflow-y-auto bg-[#f8fafc]">
      <header className="sticky top-0 z-30" style={{ background: 'linear-gradient(to right, #1d4ed8, #2563eb)', boxShadow: '0 2px 8px rgba(15,23,42,.12)' }}>
        <div className="flex items-center justify-between px-4" style={{ height: 52 }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#5ad6a7] flex items-center justify-center shrink-0"><span className="text-white text-xs font-bold select-none">LN</span></div>
            <span className="text-white font-semibold text-sm select-none">Admin Console</span>
          </div>
          <button onClick={() => router.push('/generate')} className="text-white/80 text-sm hover:text-white motion-safe:transition-colors">← Back to app</button>
        </div>
        {/* Section navbar */}
        <nav className="flex gap-1 px-3 pb-2">
          {SECTIONS.map(s => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium motion-safe:transition-colors ${
                section === s.key ? 'bg-white text-[#1d4ed8]' : 'text-white/85 hover:bg-white/10'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {PANELS[section]}
    </div>
  )
}
