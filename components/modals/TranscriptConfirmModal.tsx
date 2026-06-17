'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { formatDob } from '@/lib/utils'
import type { Note } from '@/types'

interface TranscriptConfirmModalProps {
  open: boolean
  transcript: string
  allNotes: Note[]
  onConfirm: (patient: string, regNumber: string, dob: string, gender: 'male' | 'female' | '', isNewPatient: boolean) => void
  onClose: () => void
}

// Registration ID = today's date (YYYYMMDD) + a 3-digit daily sequence.
// The sequence is "the Nth patient registered today", read from existing
// reg numbers that share today's prefix. Minted once per new patient; a
// returning patient keeps the reg already on their record.
function suggestNextReg(allNotes: Note[]): string {
  const now = new Date()
  const prefix =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  const max = allNotes
    .map(n => n.reg_number || '')
    .filter(r => r.startsWith(prefix))
    .reduce((m, r) => Math.max(m, parseInt(r.slice(8), 10) || 0), 0)
  return prefix + String(max + 1).padStart(3, '0')
}

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

export default function TranscriptConfirmModal({
  open,
  transcript,
  allNotes,
  onConfirm,
  onClose,
}: TranscriptConfirmModalProps) {
  const { profile } = useAuth()
  const [patientName, setPatientName] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | ''>('')
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) {
      setPatientName('')
      setRegNumber('')
      setShowDropdown(false)
      setDob('')
      setGender('')
      setDropdownRect(null)
    } else {
      setShowDropdown(false)
      setDropdownRect(null)
    }
  }, [open])

  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript]
  )
  const preview = useMemo(() => {
    const sentences = transcript.trim().split(/[.!?]+\s+/)
    return sentences.slice(0, 3).join(' ').slice(0, 280).trim()
  }, [transcript])
  const hasMore = transcript.trim().length > preview.length

  const regPlaceholder = useMemo(() => {
    const wps = profile?.workplaces ?? []
    const aw = wps.find(w => w.id === profile?.activeWorkplaceId) ?? wps[0]
    return aw?.regTemplate ?? 'e.g. 100234'
  }, [profile])

  const patientIndex = useMemo(() => {
    const seen = new Map<string, { name: string; reg: string }>()
    allNotes.forEach(n => {
      if (!n.patient) return
      const key = n.patient.toLowerCase()
      if (!seen.has(key)) {
        seen.set(key, { name: n.patient, reg: n.reg_number || '' })
      } else if (!seen.get(key)!.reg && n.reg_number) {
        seen.get(key)!.reg = n.reg_number
      }
    })
    return Array.from(seen.values())
  }, [allNotes])

  const filteredPatients = useMemo(() => {
    if (!patientName.trim()) return []
    const q = patientName.trim().toLowerCase()
    return patientIndex.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [patientName, patientIndex])

  const exactMatch = useMemo(() => {
    if (!patientName.trim()) return null
    return patientIndex.find(p => p.name.toLowerCase() === patientName.trim().toLowerCase()) ?? null
  }, [patientName, patientIndex])

  const isNewPatient = patientName.trim().length > 0 && exactMatch === null

  const suggestedReg = useMemo(() => {
    if (!isNewPatient) return ''
    return suggestNextReg(allNotes)
  }, [isNewPatient, allNotes])

  useEffect(() => {
    if (suggestedReg && !regNumber) setRegNumber(suggestedReg)
  }, [suggestedReg]) // eslint-disable-line react-hooks/exhaustive-deps

  // Returning patient (exact name match) reuses their existing reg
  useEffect(() => {
    if (exactMatch?.reg && !regNumber) setRegNumber(exactMatch.reg)
  }, [exactMatch]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateDropdownPos() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }

  function handlePatientNameChange(value: string) {
    setPatientName(value)
    setRegNumber('')
    if (value.trim()) {
      updateDropdownPos()
      setShowDropdown(true)
    } else {
      setShowDropdown(false)
    }
  }

  function handleSelectPatient(name: string, reg: string) {
    setPatientName(toTitleCase(name))
    setRegNumber(reg)
    setShowDropdown(false)
  }

  function handleConfirm() {
    if (!patientName.trim()) return
    onConfirm(patientName.trim(), regNumber, dob, gender, isNewPatient)
  }

  const dropdown =
    mounted && showDropdown && filteredPatients.length > 0 && dropdownRect
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              top: dropdownRect.top,
              left: dropdownRect.left,
              width: dropdownRect.width,
              maxHeight: 240,
              zIndex: 9999,
            }}
            className="bg-white border border-[var(--border)] rounded-[var(--r)] shadow-lg overflow-y-auto scrollbar-none"
          >
            {filteredPatients.map(p => (
              <button
                key={p.name}
                type="button"
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--bg)] border-b border-[var(--border)] last:border-0 flex items-center justify-between gap-2"
                onMouseDown={e => {
                  e.preventDefault()
                  handleSelectPatient(p.name, p.reg)
                }}
              >
                <span className="text-[var(--text)]">{toTitleCase(p.name)}</span>
                {p.reg && (
                  <span className="text-xs text-[var(--text3)] font-mono shrink-0">{p.reg}</span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <>
      <Modal open={open} onClose={onClose} title="Confirm transcript" maxWidth="md">
        <div className="px-5 pb-5 space-y-4">

          <div className="flex items-center justify-between">
            <span className="text-[0.68rem] font-bold tracking-[0.06em] uppercase text-[var(--text3)]">
              Clipboard preview
            </span>
            <span className="text-xs text-[var(--text3)]">{wordCount} words</span>
          </div>

          <div
            className="relative bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r-sm)] px-4 py-3 text-sm text-[var(--text)] leading-relaxed overflow-hidden"
            style={{ maxHeight: 120 }}
          >
            <span>{preview}{hasMore ? '…' : ''}</span>
            <div
              className="absolute bottom-0 left-0 right-0 h-9 pointer-events-none"
              style={{ background: 'linear-gradient(to bottom, transparent, #f8fafc)' }}
            />
          </div>

          <p className="text-sm text-[var(--text2)]">
            Does this look like your consultation transcript?
          </p>

          <div className="border-t border-[var(--border)] pt-4 space-y-3">
            <p className="text-[0.68rem] font-bold tracking-[0.06em] uppercase text-[var(--text3)]">
              Assign to Patient{' '}
              <span className="font-normal normal-case tracking-normal">· optional</span>
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                  Patient name
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={patientName}
                  onChange={e => handlePatientNameChange(e.target.value)}
                  onFocus={() => {
                    if (patientName.trim() && filteredPatients.length > 0) {
                      updateDropdownPos()
                      setShowDropdown(true)
                    }
                  }}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  placeholder="First name or full name"
                  autoFocus
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                  Patient ID / Reg #
                </label>
                <input
                  type="text"
                  value={regNumber}
                  onChange={e => setRegNumber(e.target.value)}
                  placeholder={regPlaceholder}
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
                />
              </div>
            </div>

            {isNewPatient && (
              <div className="pt-3 border-t border-dashed border-[var(--border)]">
                <p className="text-xs font-semibold text-green-600 flex items-center gap-1 mb-3">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                  New patient — a couple more details
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                      Date of birth{' '}
                      <span className="font-normal text-[var(--text3)]">(optional)</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="DD/MM/YYYY"
                      maxLength={10}
                      value={dob}
                      onChange={e => setDob(formatDob(e.target.value))}
                      className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                      Gender{' '}
                      <span className="font-normal text-[var(--text3)]">(optional)</span>
                    </label>
                    <div className="flex gap-2">
                      {(['male', 'female'] as const).map(g => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGender(prev => prev === g ? '' : g)}
                          className={`flex-1 py-2 rounded-[var(--r-sm)] text-sm font-medium border capitalize motion-safe:transition-colors ${
                            gender === g
                              ? 'bg-[var(--blue-lt)] border-[var(--blue)] text-[var(--blue)]'
                              : 'bg-white border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)]'
                          }`}
                        >
                          {g.charAt(0).toUpperCase() + g.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={!patientName.trim()}
              className="flex-[2]"
            >
              Yes, generate note →
            </Button>
          </div>
        </div>
      </Modal>
      {dropdown}
    </>
  )
}
