'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useNoteStore } from '@/hooks/useNoteStore'

const GenerateIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14,2 14,8 20,8"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
    <line x1="9" y1="17" x2="13" y2="17"/>
  </svg>
)
const EditIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
)
const ExportIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
    <polyline points="16,6 12,2 8,6"/>
    <line x1="12" y1="2" x2="12" y2="15"/>
  </svg>
)
const TranscriptIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)
const HistoryIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12,6 12,12 16,14"/>
  </svg>
)
const PatientsIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
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
    <>
      {/* Spacer so content doesn't hide behind fixed pill */}
      <div className="shrink-0" style={{ height: 88 }} aria-hidden data-tab-bar />

      {/* Floating liquid glass pill */}
      <nav
        className="fixed bottom-4 left-4 right-4 z-30 flex items-center px-2"
        style={{
          height: 64,
          borderRadius: 32,
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          background: 'rgba(10,15,30,0.52)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 8px 32px rgba(10,15,30,0.28), inset 0 1px 0 rgba(255,255,255,0.10)',
        }}
      >
        {tabs.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 relative motion-safe:transition-all"
              style={{ minWidth: 0 }}
            >
              {/* Active capsule highlight */}
              {active && (
                <span
                  className="absolute inset-x-0.5 rounded-[26px]"
                  style={{
                    top: -4,
                    bottom: -4,
                    background: 'var(--blue)',
                    boxShadow: [
                      '0 4px 18px color-mix(in srgb, var(--blue) 55%, transparent)',
                      'inset 0 1.5px 0 rgba(255,255,255,0.38)',
                      'inset 0 -1px 0 rgba(0,0,0,0.15)',
                      '0 1px 3px rgba(0,0,0,0.25)',
                    ].join(', '),
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.22)',
                  }}
                  aria-hidden
                />
              )}
              <span className={`relative flex flex-col items-center gap-0.5 py-1
                ${active ? 'text-white' : 'text-white/45'}`}
              >
                {icon}
                <span className="text-[9px] font-semibold tracking-wide">{label}</span>
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
