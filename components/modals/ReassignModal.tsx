'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import type { Note } from '@/types'

interface ReassignModalProps {
  open: boolean
  allNotes: Note[]
  onConfirm: (patient: string, regNumber: string) => void
  onClose: () => void
}

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

export default function ReassignModal({ open, allNotes, onConfirm, onClose }: ReassignModalProps) {
  const [patientName, setPatientName] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setPatientName('')
      setRegNumber('')
      setShowDropdown(false)
      // Delay focus so modal animation completes; on iOS this won't show
      // the keyboard (iOS blocks programmatic keyboard) but it primes the
      // input so the user's first tap shows the keyboard immediately.
      setTimeout(() => inputRef.current?.focus(), 300)
    } else {
      setShowDropdown(false)
    }
  }, [open])

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

  // The dropdown renders right below the input in normal flow, but the mobile
  // keyboard's native "scroll focused field into view" doesn't reliably scroll
  // far enough to also reveal it (varies by browser). Do it ourselves once the
  // keyboard has finished animating in.
  useEffect(() => {
    if (!showDropdown || filteredPatients.length === 0) return
    const t = setTimeout(() => {
      dropdownRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 300)
    return () => clearTimeout(t)
  }, [showDropdown, filteredPatients.length])

  function handlePatientNameChange(value: string) {
    setPatientName(value)
    setRegNumber('')
    setShowDropdown(value.trim().length > 0)
  }

  function handleSelectPatient(name: string, reg: string) {
    setPatientName(toTitleCase(name))
    setRegNumber(reg)
    setShowDropdown(false)
  }

  function handleConfirm() {
    if (!patientName.trim()) return
    onConfirm(patientName.trim(), regNumber)
  }

  return (
      <Modal open={open} onClose={onClose} title="Reassign Patient" maxWidth="sm">
        <div className="px-5 pb-5 space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-[var(--text)] mb-1.5">
              Patient name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={patientName}
              onChange={e => handlePatientNameChange(e.target.value)}
              onFocus={() => {
                if (patientName.trim() && filteredPatients.length > 0) setShowDropdown(true)
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Search or enter patient name"
              inputMode="text"
              className="w-full px-3 py-2.5 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
            {/* Normal-flow dropdown (absolute, relative to this field) instead of a
                fixed-position portal with manual visualViewport math — that
                positioned correctly on some browsers but landed in the wrong
                place on others depending on keyboard-resize timing. */}
            {showDropdown && filteredPatients.length > 0 && (
              <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto scrollbar-none bg-white border border-[var(--border)] rounded-[var(--r)] shadow-lg">
                {filteredPatients.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--bg)] border-b border-[var(--border)] last:border-0 text-[var(--text)]"
                    onMouseDown={e => {
                      e.preventDefault()
                      handleSelectPatient(p.name, p.reg)
                    }}
                  >
                    <span>{toTitleCase(p.name)}</span>
                    {p.reg && <span className="ml-2 text-xs text-[var(--text3)]">{p.reg}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Input
            label="Registration number"
            value={regNumber}
            onChange={e => setRegNumber(e.target.value)}
            placeholder="Auto-filled on selection"
          />

          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!patientName.trim()}
            className="w-full"
          >
            Reassign
          </Button>
        </div>
      </Modal>
  )
}
