'use client'

import type { LetterType } from '@/types'

interface Props {
  open: boolean
  onSelect: (type: LetterType) => void
  onClose: () => void
}

const LETTERS = [
  {
    type: 'referral' as LetterType,
    title: 'Referral Letter',
    description: 'Refer a patient to another clinician with admission details and clinical summary.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
    ),
  },
  {
    type: 'records' as LetterType,
    title: 'Request Medical Records',
    description: 'Request correspondence and documentation from a previous provider.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
      </svg>
    ),
  },
  {
    type: 'freetext' as LetterType,
    title: 'Free Text Letter',
    description: 'Write a custom professional letter with your own content.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
      </svg>
    ),
  },
]

export default function LetterPickerModal({ open, onSelect, onClose }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-[var(--r-lg)] p-5 space-y-3"
        style={{
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
        }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-[var(--text)]">Choose letter type</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[var(--bg)] text-[var(--text3)] motion-safe:transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {LETTERS.map(({ type, title, description, icon }) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="w-full flex items-center gap-4 p-4 rounded-[var(--r-lg)] bg-white border border-[var(--border)] text-left
              hover:border-[var(--blue)] hover:shadow-sm
              motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150">
            <span className="text-[var(--blue)] shrink-0">{icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
              <p className="text-xs text-[var(--text2)] leading-snug mt-0.5">{description}</p>
            </div>
            <svg className="ml-auto shrink-0 text-[var(--text3)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        ))}
      </div>
    </div>
  )
}
