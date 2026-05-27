'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNoteStore } from '@/hooks/useNoteStore'
import { useAuth } from '@/hooks/useAuth'
import { downloadNotePDF } from '@/lib/pdf'
import type { Note } from '@/types'

// All note sections in display order
const PREVIEW_FIELDS: { key: keyof Note; label: string }[] = [
  { key: 'diagnosis',    label: 'Diagnosis' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'history',      label: 'History' },
  { key: 'medications',  label: 'Medications' },
  { key: 'mse',          label: 'Mental Status Examination' },
  { key: 'content',      label: 'Session Content' },
  { key: 'scales',       label: 'Scales' },
  { key: 'risk',         label: 'Risk' },
  { key: 'referrals',    label: 'Referrals' },
  { key: 'summary',      label: 'Summary' },
  { key: 'nextsteps',    label: 'Next Steps' },
]

function buildPlainText(note: Partial<Note>): string {
  const lines: string[] = []
  if (note.patient)  lines.push(`Patient: ${note.patient}`)
  if (note.date)     lines.push(`Date: ${note.date}`)
  if (note.clinician) lines.push(`Clinician: ${note.clinician}`)
  for (const { key, label } of PREVIEW_FIELDS) {
    const val = (note[key] as string | undefined)?.trim()
    if (val) lines.push(`\n${label.toUpperCase()}\n${val}`)
  }
  return lines.join('\n')
}

export default function ExportPage() {
  const router = useRouter()
  const { currentNote } = useNoteStore()
  const { profile } = useAuth()

  const [copied, setCopied] = useState(false)

  const isEmpty = !currentNote.patient && !currentNote.content && !currentNote.summary

  async function handleCopy() {
    const text = buildPlainText(currentNote)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent(
      `Progress Note — ${currentNote.patient || 'Patient'} ${currentNote.date || ''}`.trim()
    )
    const pretext = profile?.emailPretext ? `${profile.emailPretext}\n\n` : ''
    const body = encodeURIComponent(`${pretext}${buildPlainText(currentNote)}`)
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  function handlePDF() {
    downloadNotePDF(currentNote, profile?.displayName)
  }

  // ── Empty state ───────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--bg)] flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text3)]" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-[var(--text)]">No note to export</p>
          <p className="text-xs text-[var(--text3)] mt-1">
            Go to the Generate tab to create a note first.
          </p>
        </div>
        <button
          onClick={() => router.push('/generate')}
          className="px-4 py-2 rounded-[var(--r)] bg-[#10b981] text-white text-sm font-medium
                     hover:bg-[#059669] active:scale-[0.97] transition-all"
        >
          Generate a note
        </button>
      </div>
    )
  }

  // ── Main export page ──────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-5 pb-24 space-y-4">

        {/* Note summary card */}
        <div
          className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          {currentNote.patient && (
            <p className="text-base font-semibold text-[var(--text)] truncate">{currentNote.patient}</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {currentNote.date && (
              <span className="text-xs text-[var(--text2)]">{currentNote.date}</span>
            )}
            {currentNote.time && (
              <span className="text-xs text-[var(--text3)]">{currentNote.time}</span>
            )}
            {currentNote.clinician && (
              <span className="text-xs text-[var(--text2)]">{currentNote.clinician}</span>
            )}
          </div>
        </div>

        {/* Action cards */}
        <div className="space-y-3">

          {/* PDF */}
          <div
            className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4 flex items-center gap-4"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--blue-lt)] flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <polyline points="9,15 12,18 15,15"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">Download as PDF</p>
              <p className="text-xs text-[var(--text3)]">Save a formatted A4 PDF of this note</p>
            </div>
            <button
              onClick={handlePDF}
              className="shrink-0 px-3 py-1.5 rounded-[var(--r)] bg-[var(--blue)] text-white text-xs font-medium
                         hover:bg-[var(--blue-dk)] active:scale-[0.97] transition-all"
            >
              Download PDF
            </button>
          </div>

          {/* Clipboard */}
          <div
            className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4 flex items-center gap-4"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--blue-lt)] flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">Copy to Clipboard</p>
              <p className="text-xs text-[var(--text3)]">Copy the full note as plain text</p>
            </div>
            <button
              onClick={handleCopy}
              className={`shrink-0 px-3 py-1.5 rounded-[var(--r)] text-xs font-medium
                          active:scale-[0.97] transition-all
                          ${copied
                            ? 'bg-[#059669] text-white'
                            : 'bg-[var(--blue)] text-white hover:bg-[var(--blue-dk)]'}`}
            >
              {copied ? 'Copied!' : 'Copy Note'}
            </button>
          </div>

          {/* Email */}
          <div
            className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4 flex items-center gap-4"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--blue-lt)] flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text)]">Send to Colleague</p>
              <p className="text-xs text-[var(--text3)]">Open your email client with this note pre-filled</p>
            </div>
            <button
              onClick={handleEmail}
              className="shrink-0 px-3 py-1.5 rounded-[var(--r)] bg-[var(--blue)] text-white text-xs font-medium
                         hover:bg-[var(--blue-dk)] active:scale-[0.97] transition-all"
            >
              Open in Email
            </button>
          </div>
        </div>

        {/* Print */}
        <div className="flex justify-center">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-sm text-[var(--text2)] hover:text-[var(--text)] transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <polyline points="6,9 6,2 18,2 18,9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print
          </button>
        </div>

        {/* Read-only preview */}
        <div className="pt-2 border-t border-[var(--border)]">
          <p className="text-xs font-semibold text-[var(--text3)] uppercase tracking-wide mb-3">
            Note preview
          </p>
          <div className="space-y-4">
            {PREVIEW_FIELDS.map(({ key, label }) => {
              const val = (currentNote[key] as string | undefined)?.trim()
              if (!val) return null
              return (
                <div key={key}>
                  <p className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wide mb-1">
                    {label}
                  </p>
                  <p className="text-sm text-[var(--text2)] whitespace-pre-wrap leading-relaxed">
                    {val}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
