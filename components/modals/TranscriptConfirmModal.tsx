'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { formatDob } from '@/lib/utils'
import type { Note } from '@/types'

interface TranscriptConfirmModalProps {
  open: boolean
  transcript: string
  allNotes: Note[]
  onConfirm: (patient: string, regNumber: string, dob: string, gender: 'male' | 'female' | '', isNewPatient: boolean, sessionNumber: string, attendance: string) => void
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
  const [regOverridden, setRegOverridden] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | ''>('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setPatientName('')
      setRegNumber('')
      setRegOverridden(false)
      setShowDropdown(false)
      setDob('')
      setGender('')
    } else {
      setShowDropdown(false)
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

  const activeWorkplace = useMemo(() => {
    const wps = profile?.workplaces ?? []
    return wps.find(w => w.id === profile?.activeWorkplaceId) ?? wps[0]
  }, [profile])
  // 'none' (or unset) → app auto-mints YYYYMMDDNNN. 'existing' → clinician types
  // the real hospital number, so we leave it blank for manual entry.
  const autoReg = activeWorkplace?.regSystem !== 'existing'
  const regPlaceholder = activeWorkplace?.regTemplate ?? 'e.g. 100234'

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

  // The dropdown renders in normal flow right below the input, but the mobile
  // keyboard's native "scroll focused field into view" doesn't reliably scroll
  // far enough to also reveal it — how much extra margin browsers add differs
  // (Safari happened to scroll past it, Brave stopped right at the input). Do
  // it ourselves once the keyboard has finished animating in, so it's visible
  // on every browser rather than depending on that native behaviour.
  useEffect(() => {
    if (!showDropdown || filteredPatients.length === 0) return
    const t = setTimeout(() => {
      dropdownRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 300)
    return () => clearTimeout(t)
  }, [showDropdown, filteredPatients.length])

  const exactMatch = useMemo(() => {
    if (!patientName.trim()) return null
    return patientIndex.find(p => p.name.toLowerCase() === patientName.trim().toLowerCase()) ?? null
  }, [patientName, patientIndex])

  const isNewPatient = patientName.trim().length > 0 && exactMatch === null

  // Returning patient reuses the reg already on their record. Otherwise, in
  // auto mode, mint the next YYYYMMDDNNN — both for genuinely new patients and
  // for returning patients who never got a reg (legacy notes in 'none' mode).
  // In 'existing' mode a new patient is left blank for manual entry.
  const suggestedReg = useMemo(() => {
    if (!patientName.trim()) return ''
    if (exactMatch?.reg) return exactMatch.reg
    if (autoReg) return suggestNextReg(allNotes)
    return ''
  }, [patientName, exactMatch, autoReg, allNotes])

  useEffect(() => {
    if (!regOverridden) setRegNumber(suggestedReg)
  }, [suggestedReg, regOverridden])

  function handlePatientNameChange(value: string) {
    setPatientName(value)
    setRegOverridden(false)
    setShowDropdown(value.trim().length > 0)
  }

  function handleSelectPatient(name: string, reg: string) {
    setPatientName(toTitleCase(name))
    setRegNumber(reg)
    setRegOverridden(!!reg)
    setShowDropdown(false)
  }

  function handleConfirm() {
    if (!patientName.trim()) return
    // Session number / attendance: returning patient continues from their last
    // note (session + 1, same attendance); a first-time patient starts at 1 so
    // these fields are never left blank.
    const q = patientName.trim().toLowerCase()
    const last = allNotes
      .filter(n => n.patient?.toLowerCase() === q)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    const sessionNumber = last
      ? String((parseInt(last.session_number || '0', 10) || 0) + 1)
      : '1'
    const attendance = (last?.attendance || '').trim() || '1'
    onConfirm(patientName.trim(), regNumber, dob, gender, isNewPatient, sessionNumber, attendance)
  }

  return (
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
              <div className="relative">
                <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                  Patient name
                </label>
                <input
                  type="text"
                  value={patientName}
                  onChange={e => handlePatientNameChange(e.target.value)}
                  onFocus={() => {
                    if (patientName.trim() && filteredPatients.length > 0) {
                      setShowDropdown(true)
                    }
                  }}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  placeholder="First name or full name"
                  autoFocus
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 motion-safe:transition-colors"
                />
                {/* Suggestions render in normal document flow (absolute, relative to
                    this field) instead of a fixed-position portal with manual
                    visualViewport math — that approach positioned correctly on
                    some browsers but landed in the wrong place on others (Safari)
                    depending on exactly when the keyboard resize fired. Normal flow
                    has no browser-timing dependency: the surrounding scroll
                    container reveals it like any other content. */}
                {showDropdown && filteredPatients.length > 0 && (
                  <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto scrollbar-none bg-white border border-[var(--border)] rounded-[var(--r)] shadow-lg">
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
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                  Patient ID / Reg #
                </label>
                <input
                  type="text"
                  value={regNumber}
                  onChange={e => { setRegNumber(e.target.value); setRegOverridden(true) }}
                  placeholder={regPlaceholder}
                  onFocus={e => {
                    const el = e.target
                    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
                  }}
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
                  New patient - a couple more details
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
                      autoComplete="off"
                      // This field sits low in the modal, in a section that only
                      // appears once a new patient name is typed — the keyboard's
                      // native scroll-into-view doesn't reliably reach it (it was
                      // ending up hidden below the keyboard entirely, which is what
                      // actually looked like invisible typing, not a colour bug).
                      // Scroll it into view ourselves once the keyboard settles.
                      onFocus={e => {
                        const el = e.target
                        setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
                      }}
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
  )
}
