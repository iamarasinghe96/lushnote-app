'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

const tabs = [
  { label: 'Generate', href: '/generate', icon: GenerateIcon },
  { label: 'Edit',     href: '/edit',     icon: EditIcon     },
  { label: 'Export',   href: '/export',   icon: ExportIcon   },
  { label: 'History',  href: '/history',  icon: HistoryIcon  },
  { label: 'Patients', href: '/patients', icon: PatientsIcon },
]

export default function TabBar() {
  const pathname = usePathname()
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([])

  const activeIdx = tabs.findIndex(t => pathname.startsWith(t.href))

  useEffect(() => {
    if (activeIdx >= 0) {
      linkRefs.current[activeIdx]?.scrollIntoView({ inline: 'center', behavior: 'smooth' })
    }
  }, [activeIdx])

  return (
    <nav
      className="relative z-30 shrink-0 backdrop-blur-lg bg-white/85 border-t border-white/50
                 scrollbar-none overflow-x-auto pb-safe"
      style={{
        boxShadow: '0 -2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
        WebkitOverflowScrolling: 'touch' as never,
      }}
      aria-label="Main navigation"
    >
      <div className="flex min-w-max mx-auto" style={{ height: 56 }}>
        {tabs.map((tab, i) => {
          const active = i === activeIdx
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              ref={el => { linkRefs.current[i] = el }}
              className={`flex flex-col items-center justify-center gap-0.5 px-4 min-w-[64px] flex-1
                          transition-opacity duration-150 select-none
                          ${active ? 'text-[var(--blue)]' : 'text-[var(--text3)]'}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon active={active} />
              <span
                className="text-[10px] leading-none"
                style={{ fontWeight: active ? 600 : 400 }}
              >
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/* ── Icons ──────────────────────────────────────────────── */

function iconProps(active: boolean) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: active ? 2 : 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
}

function GenerateIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M11 2H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-5-5z"/>
      <polyline points="11 2 11 7 16 7"/>
      <line x1="7" y1="10" x2="13" y2="10"/>
      <line x1="7" y1="13" x2="11" y2="13"/>
    </svg>
  )
}

function EditIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M13 2.5 17.5 7 7.5 17H3v-4.5L13 2.5z"/>
      <line x1="11.5" y1="4" x2="16" y2="8.5"/>
    </svg>
  )
}

function ExportIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M10 2v10M7 5l3-3 3 3"/>
      <path d="M5 9v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9"/>
    </svg>
  )
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <circle cx="10" cy="10" r="8"/>
      <polyline points="10 6 10 10 13 12"/>
    </svg>
  )
}

function PatientsIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <circle cx="8" cy="7" r="3"/>
      <path d="M2 18a6 6 0 0 1 12 0"/>
      <circle cx="15" cy="7" r="2.5"/>
      <path d="M12.5 18a4.5 4.5 0 0 1 5 0"/>
    </svg>
  )
}
