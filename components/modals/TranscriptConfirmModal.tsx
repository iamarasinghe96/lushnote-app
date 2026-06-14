'use client'

import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Note } from '@/types'

interface TranscriptConfirmModalProps {
  open: boolean
  transcript: string
  allNotes: Note[]
  onConfirm: (patient: string, regNumber: string) => void
  onClose: () => void
}

const PREVIEW_CHARS = 240

function suggestNextReg(dob: string, allNotes: Note[]): string {
  const parts = dob.split('/')
  if (parts.length !== 3 || parts[2].length !== 4) return ''
  const prefix = parts[2] + parts[1] + parts[0]
  const max = allNotes
    .map(n => n.reg_number || '')
    .filter(r => r.startsWith(prefix))
    .reduce((m, r) => Math.max(m, parseInt(r.slice(8), 10) || 0), 0)
  return prefix + String(max + 1).padStart(3, '0')
}

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

function autoFormatDOB(raw: string, prev: string): string {
  // Strip all non-digits
  const digits = raw.replace(/\D/g, '')
  // Auto-insert slashes at positions 2 and 5
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8)
}

export default function TranscriptConfirmModal({
  open,
  transcript,
  allNotes,
  onConfirm,
  onClose,
}: TranscriptConfirmModalProps) {
  const [patientName, setPatientName] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) {
      setPatientName('')
      setRegNumber('')
      setDob('')
      setGender('')
    }
  }, [open])

  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript]
  )

  const preview = transcript.slice(0, PREVIEW_CHARS)
  const truncated = transcript.length > PREVIEW_CHARS

  const patientIndex = useMemo(() => {
    const seen = new Map<string, string>()
    allNotes.forEach(n => {
      if (n.patient) seen.set(n.patient.toLowerCase(), n.reg_number || '')
    })
    return Array.from(seen.entries()).map(([name, reg]) => ({ name, reg }))
  }, [allNotes])

  const exactMatch = useMemo(() => {
    if (!patientName.trim()) return null
    return patientIndex.find(p => p.name === patientName.trim().toLowerCase()) ?? null
  }, [patientName, patientIndex])

  const isNewPatient = patientName.trim().length > 0 && exactMatch === null

  const suggestedReg = useMemo(() => {
    if (!isNewPatient || !dob) return ''
    return suggestNextReg(dob, allNotes)
  }, [isNewPatient, dob, allNotes])

  function handlePatientNameChange(val: string) {
    const formatted = toTitleCase(val)
    setPatientName(formatted)
    if (!isNewPatient && exactMatch) {
      setRegNumber(exactMatch.reg)
    }
  }

  function handleDobChange(e: React.ChangeEvent<HTMLInputElement>) {
    setDob(autoFormatDOB(e.target.value, dob))
  }

  function handleConfirm() {
    const reg = regNumber.trim() || (exactMatch ? exactMatch.reg : suggestedReg)
    onConfirm(patientName.trim(), reg)
  }

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="relative w-full max-w-md rounded-t-[20px] sm:rounded-[20px] overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(16px)',
          boxShadow: '0 4px 24px rgba(15,23,42,.12), 0 0 0 1px rgba(255,255,255,0.45)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <span className="text-[10px] font-bold tracking-widest text-[var(--text3)] uppercase">
            Clipboard Preview
          </span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200">
              {wordCount} words
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 rounded-full bg-[var(--bg)] flex items-center justify-center text-[var(--text3)] hover:text-[var(--text)] active:scale-95 motion-safe:transition-transform"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="1" y1="1" x2="13" y2="13"/>
                <line x1="13" y1="1" x2="1" y2="13"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 pb-5 space-y-4 overflow-y-auto" style={{ maxHeight: '80vh' }}>
          {/* Transcript preview */}
          <div
            className="relative rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] px-3 py-2.5 overflow-hidden"
            style={{ maxHeight: 88 }}
          >
            <p className="text-xs text-[var(--text2)] leading-relaxed whitespace-pre-wrap break-words">
              {preview}{truncated ? '…' : ''}
            </p>
            <div
              className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, transparent, #f8fafc)' }}
            />
          </div>

          {/* Question */}
          <p className="text-sm font-medium text-[var(--text)]">
            Does this look like your consultation transcript?
          </p>

          {/* Patient assignment */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold tracking-widest text-[var(--text3)] uppercase">
              Assign to patient (optional)
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={patientName}
                onChange={e => handlePatientNameChange(e.target.value)}
                placeholder="Patient name"
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
              />
              <input
                type="text"
                value={regNumber}
                onChange={e => setRegNumber(e.target.value)}
                placeholder="Patient ID / Reg #"
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
              />
            </div>

            {/* New patient fields */}
            {isNewPatient && (
              <div className="rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] p-3 space-y-2">
                <p className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wide">
                  New patient
                </p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--text2)] mb-1">
                      Date of birth
                    </label>
                    <input
                      type="text"
                      value={dob}
                      onChange={handleDobChange}
                      placeholder="DD/MM/YYYY"
                      maxLength={10}
                      className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--text2)] mb-1">
                      Gender
                    </label>
                    <select
                      value={gender}
                      onChange={e => setGender(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
                    >
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                      <option value="prefer-not-to-say">Prefer not to say</option>
                    </select>
                  </div>
                </div>
                {suggestedReg && !regNumber && (
                  <p className="text-xs text-[var(--text2)]">
                    Suggested ID:{' '}
                    <button
                      type="button"
                      onClick={() => setRegNumber(suggestedReg)}
                      className="font-mono font-semibold text-[var(--blue)] hover:underline"
                    >
                      {suggestedReg}
                    </button>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-medium border border-[var(--border)] rounded-[var(--r)] text-[var(--text2)] hover:border-[var(--blue)]/50 motion-safe:transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-2.5 text-sm font-semibold rounded-[var(--r)] text-white motion-safe:active:scale-[0.98] motion-safe:transition-transform"
              style={{ background: '#10b981' }}
            >
              Yes, generate report
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
