'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import type { LetterType, CustomLetterTemplate } from '@/types'

interface LetterPickerModalProps {
  open: boolean
  onSelect: (letterType: LetterType) => void
  onSelectClinicalNote?: () => void
  onClose: () => void
  customTemplates?: CustomLetterTemplate[]
  onSelectCustom?: (template: CustomLetterTemplate) => void
  onCreateTemplate?: () => void
}

const CARD_CLASS = `w-full flex items-center gap-4 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
  focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
  motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150`
const CARD_STYLE = {
  background: 'rgba(255,255,255,0.75)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
} as const

const LETTER_OPTIONS = [
  {
    type: 'referral' as LetterType,
    title: 'Referral Letter',
    description: 'Refer a patient to a specialist, unit, or service',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    ),
  },
  {
    type: 'records' as LetterType,
    title: 'Request Medical Records',
    description: 'Request clinical notes, investigations, or discharge summaries',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    type: 'freetext' as LetterType,
    title: 'Free Text Letter',
    description: 'Write or dictate a custom letter with your own content',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
  },
]

export default function LetterPickerModal({ open, onSelect, onSelectClinicalNote, onClose, customTemplates = [], onSelectCustom, onCreateTemplate }: LetterPickerModalProps) {
  const [search, setSearch] = useState('')
  const showSearch = LETTER_OPTIONS.length + customTemplates.length > 5
  const q = search.trim().toLowerCase()
  const builtins = q ? LETTER_OPTIONS.filter(o => o.title.toLowerCase().includes(q)) : LETTER_OPTIONS
  const customs = q ? customTemplates.filter(t => t.title.toLowerCase().includes(q)) : customTemplates

  return (
    <Modal open={open} onClose={onClose} title="Choose what to write" maxWidth="md">
      <div className="px-5 pb-5">
        <p className="text-sm text-[var(--text2)]">Generate a letter, or write a clinical note from scratch</p>
        {showSearch && (
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search letter types…"
            className="w-full mt-3 text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10"
          />
        )}
        <div className="space-y-3 mt-4">
          {builtins.map(opt => (
            <button key={opt.type} onClick={() => onSelect(opt.type)} className={CARD_CLASS} style={CARD_STYLE}>
              <span className="text-[var(--blue)] shrink-0">{opt.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">{opt.title}</p>
                <p className="text-xs text-[var(--text3)] mt-0.5">{opt.description}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" className="text-[var(--text3)] shrink-0" aria-hidden>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}

          {onSelectCustom && customs.map(t => (
            <button key={t.id} onClick={() => onSelectCustom(t)} className={CARD_CLASS} style={CARD_STYLE}>
              <span className="text-[var(--blue)] shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text)] truncate">{t.title}</p>
                <p className="text-xs text-[var(--text3)] mt-0.5 truncate">{t.description || `${t.sections.length} topic${t.sections.length !== 1 ? 's' : ''}`}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" className="text-[var(--text3)] shrink-0" aria-hidden>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          ))}

          {onCreateTemplate && !q && (
            <button onClick={onCreateTemplate}
              className="w-full flex items-center gap-4 p-4 rounded-[var(--r-lg)] border border-dashed border-[var(--border)]
                text-left text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)]
                motion-safe:active:scale-[0.97] motion-safe:transition-all">
              <span className="shrink-0 text-lg leading-none">+</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Create your own template</p>
                <p className="text-xs text-[var(--text3)] mt-0.5">Define a reusable letter type — only you can see it</p>
              </div>
            </button>
          )}
        </div>

        {onSelectClinicalNote && (
          <>
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-[var(--border)]" />
              <span className="text-xs text-[var(--text3)]">or</span>
              <div className="flex-1 h-px bg-[var(--border)]" />
            </div>
            <button
              onClick={onSelectClinicalNote}
              className="w-full flex items-center gap-4 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
                text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150"
              style={{
                background: 'rgba(255,255,255,0.75)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
              }}
            >
              <span className="text-[#10b981] shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <path d="M12 18v-6"/>
                  <path d="M9 15h6"/>
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text)]">Psychiatry Clinical Note</p>
                <p className="text-xs text-[var(--text3)] mt-0.5">Write a consultation note manually using a clinical template</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" className="text-[var(--text3)] shrink-0" aria-hidden>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
