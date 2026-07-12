'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  const [mounted, setMounted] = useState(false)
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (open) {
      setPatientName('')
      setRegNumber('')
      setShowDropdown(false)
      setDropdownRect(null)
      // Delay focus so modal animation completes; on iOS this won't show
      // the keyboard (iOS blocks programmatic keyboard) but it primes the
      // input so the user's first tap shows the keyboard immediately.
      setTimeout(() => inputRef.current?.focus(), 300)
    } else {
      setShowDropdown(false)
      setDropdownRect(null)
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

  // Place the dropdown in the visible area — flipped above the field when the
  // mobile keyboard (which shrinks visualViewport) would otherwise cover it.
  function updateDropdownPos() {
    const el = inputRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const visibleTop = vv ? vv.offsetTop : 0
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
    const GAP = 4
    const MAX = 240
    const spaceBelow = visibleBottom - rect.bottom - GAP
    const spaceAbove = rect.top - visibleTop - GAP
    let top: number
    let maxHeight: number
    if (spaceBelow >= spaceAbove) {
      top = rect.bottom + GAP
      maxHeight = Math.min(MAX, Math.max(0, spaceBelow))
    } else {
      maxHeight = Math.min(MAX, Math.max(0, spaceAbove))
      top = rect.top - GAP - maxHeight
    }
    setDropdownRect({ top, left: rect.left, width: rect.width, maxHeight })
  }

  // Reposition when the keyboard opens/closes or the view scrolls.
  useEffect(() => {
    if (!showDropdown) return
    const recalc = () => updateDropdownPos()
    window.addEventListener('resize', recalc)
    window.addEventListener('scroll', recalc, true)
    window.visualViewport?.addEventListener('resize', recalc)
    window.visualViewport?.addEventListener('scroll', recalc)
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('scroll', recalc, true)
      window.visualViewport?.removeEventListener('resize', recalc)
      window.visualViewport?.removeEventListener('scroll', recalc)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDropdown])

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
    onConfirm(patientName.trim(), regNumber)
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
              maxHeight: dropdownRect.maxHeight,
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
                  handleSelectPatient(p.name, p.reg)
                }}
              >
                <span>{toTitleCase(p.name)}</span>
                {p.reg && <span className="ml-2 text-xs text-[var(--text3)]">{p.reg}</span>}
              </button>
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <>
      <Modal open={open} onClose={onClose} title="Reassign Patient" maxWidth="sm">
        <div className="px-5 pb-5 space-y-4">
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
              inputMode="text"
              className="w-full px-3 py-2.5 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] text-[var(--text)] placeholder:text-[var(--text3)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
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
      {dropdown}
    </>
  )
}
