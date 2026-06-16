'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { Note } from '@/types'

interface TranscriptConfirmModalProps {
  open: boolean
  transcript: string
  allNotes: Note[]
  onConfirm: (patient: string, regNumber: string, dob: string, gender: 'male' | 'female' | '', isNewPatient: boolean) => void
  onClose: () => void
}

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

export default function TranscriptConfirmModal({
  open,
  transcript,
  allNotes,
  onConfirm,
  onClose,
}: TranscriptConfirmModalProps) {
  const [patientName, setPatientName] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState('')
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) {
      setPatientName('')
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

  const patientIndex = useMemo(() => {
    const seen = new Map<string, string>()
    allNotes.forEach(n => {
      if (n.patient) seen.set(n.patient.toLowerCase(), n.reg_number || '')
    })
    return Array.from(seen.entries()).map(([name, reg]) => ({ name, reg }))
  }, [allNotes])

  const filteredPatients = useMemo(() => {
    if (!patientName.trim()) return []
    const q = patientName.trim().toLowerCase()
    return patientIndex.filter(p => p.name.includes(q)).slice(0, 8)
  }, [patientName, patientIndex])

  const exactMatch = useMemo(() => {
    if (!patientName.trim()) return null
    return patientIndex.find(p => p.name === patientName.trim().toLowerCase()) ?? null
  }, [patientName, patientIndex])

  const isNewPatient = patientName.trim().length > 0 && exactMatch === null

  const suggestedReg = useMemo(() => {
    if (!isNewPatient || !dob) return ''
    return suggestNextReg(dob, allNotes)
  }, [isNewPatient, dob, allNotes])

  function updateDropdownPos() {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
  }

  function handlePatientNameChange(value: string) {
    setPatientName(value)
    if (value.trim()) {
      updateDropdownPos()
      setShowDropdown(true)
    } else {
      setShowDropdown(false)
    }
  }

  function handleSelectPatient(name: string) {
    setPatientName(toTitleCase(name))
    setShowDropdown(false)
  }

  function handleConfirm() {
    if (!patientName.trim()) return
    const reg = exactMatch ? exactMatch.reg : suggestedReg
    onConfirm(patientName.trim(), reg, dob, gender as 'male' | 'female' | '', isNewPatient)
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
              maxHeight: 320,
              zIndex: 9999,
            }}
            className="bg-white border border-[var(--border)] rounded-[var(--r)] shadow-lg overflow-y-auto scrollbar-none"
          >
            {filteredPatients.map(p => (
              <button
                key={p.name}
                type="button"
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--bg)] border-b border-[var(--border)] last:border-0 text-[var(--text)]"
                onMouseDown={e => {
                  e.preventDefault()
                  handleSelectPatient(p.name)
                }}
              >
                <span>{toTitleCase(p.name)}</span>
                {p.reg && (
                  <span className="ml-2 text-xs text-[var(--text3)]">{p.reg}</span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <>
      <Modal open={open} onClose={onClose} title="Assign Patient" maxWidth="md">
        <div className="px-5 pb-5 space-y-4">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200">
            {wordCount} words
          </span>

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
              placeholder="Search or enter patient name"
              autoFocus
              className="w-full px-3 py-2.5 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
          </div>

          {isNewPatient && (
            <div className="rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--text2)] uppercase tracking-wide">
                New patient
              </p>

              <Input
                label="Date of birth (DD/MM/YYYY)"
                type="text"
                value={dob}
                onChange={e => setDob(e.target.value)}
                placeholder="DD/MM/YYYY"
              />

              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
                  Gender <span className="text-[var(--text3)] font-normal">(optional)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['male', 'female'] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(prev => prev === g ? '' : g)}
                      className={`py-2 rounded-[var(--r-sm)] text-sm font-medium border motion-safe:transition-colors capitalize ${
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

              {suggestedReg && (
                <p className="text-xs text-[var(--text2)]">
                  Suggested ID:{' '}
                  <span className="font-mono font-semibold text-[var(--text)]">
                    {suggestedReg}
                  </span>
                </p>
              )}
            </div>
          )}

          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!patientName.trim()}
            className="w-full"
          >
            Continue →
          </Button>
        </div>
      </Modal>
      {dropdown}
    </>
  )
}
