'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNoteStore } from '@/hooks/useNoteStore'

const GenerateIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14,2 14,8 20,8"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
    <line x1="9" y1="17" x2="13" y2="17"/>
  </svg>
)
const EditIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const ExportIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16,6 12,2 8,6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)
const TranscriptIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)
const HistoryIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12,6 12,12 16,14"/>
  </svg>
)
const PatientsIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

export default function TabBar() {
  const pathname = usePathname()
  const { lastTranscript } = useNoteStore()

  const tabs = [
    { href: '/generate',   label: 'Generate',   icon: GenerateIcon },
    { href: '/edit',       label: 'Edit',        icon: EditIcon },
    { href: '/export',     label: 'Export',      icon: ExportIcon },
    lastTranscript
      ? { href: '/transcript', label: 'Transcript', icon: TranscriptIcon }
      : { href: '/history',    label: 'History',    icon: HistoryIcon },
    { href: '/patients',   label: 'Patients',    icon: PatientsIcon },
  ]

  return (
    <nav
      data-tab-bar
      className="shrink-0 flex items-stretch border-t border-white/50
                 backdrop-blur-lg bg-white/85 scrollbar-none overflow-x-auto pb-safe"
      style={{
        boxShadow: '0 -1px 0 rgba(15,23,42,.05)',
        minHeight: 56,
      }}
    >
      {tabs.map(({ href, label, icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-[60px]
              text-[10px] font-medium transition-colors
              ${active ? 'text-[var(--blue)]' : 'text-[var(--text3)] hover:text-[var(--text2)]'}`}
            style={{ fontWeight: active ? 600 : 500 }}
          >
            {icon}
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
