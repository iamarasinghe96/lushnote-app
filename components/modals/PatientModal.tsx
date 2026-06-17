'use client'

import { useState, useEffect } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { savePatientProfile } from '@/lib/firestore/patients'
import { useAuth } from '@/hooks/useAuth'
import { formatDob } from '@/lib/utils'
import type { PatientProfile } from '@/types'

interface PatientModalProps {
  open: boolean
  patient?: PatientProfile
  regNumber?: string
  firstSeen?: string
  onSave: (profile: PatientProfile) => void
  onClose: () => void
}

const GENDER_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
] as const

export default function PatientModal({ open, patient, regNumber, firstSeen, onSave, onClose }: PatientModalProps) {
  const { user } = useAuth()
  const isEdit = !!patient

  const [displayName, setDisplayName] = useState(patient?.displayName ?? '')
  const [dob, setDob] = useState(patient?.dob ?? '')
  const [gender, setGender] = useState<string>(patient?.gender ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleOpen() {
    setDisplayName(patient?.displayName ?? '')
    setDob(patient?.dob ?? '')
    setGender(patient?.gender ?? '')
    setNameError(null)
  }

  useEffect(() => { if (open) handleOpen() }, [open])

  async function handleSave() {
    const trimmed = displayName.trim()
    if (!trimmed) { setNameError('Name is required'); return }
    if (!user) return
    setSaving(true)
    try {
      const profile: PatientProfile = {
        ...(patient?.id ? { id: patient.id } : {}),
        displayName: trimmed,
        ...(dob ? { dob } : {}),
        ...(gender ? { gender: gender as PatientProfile['gender'] } : {}),
      }
      const id = await savePatientProfile(user.uid, profile)
      onSave({ ...profile, id })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit patient' : 'Add patient'}>
      <div className="px-5 pb-5 space-y-4">
        <Input
          label="Display name"
          value={displayName}
          onChange={e => { setDisplayName(e.target.value); setNameError(null) }}
          error={nameError ?? undefined}
          placeholder="e.g. Jane Smith"
          autoFocus
        />

        <div className="w-full">
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Date of birth
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="DD/MM/YYYY"
            maxLength={10}
            value={dob}
            onChange={e => setDob(formatDob(e.target.value))}
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       motion-safe:transition-colors"
          />
        </div>

        <div className="w-full">
          <label className="block text-sm font-medium text-[var(--text)] mb-1">
            Gender
          </label>
          <select
            value={gender}
            onChange={e => setGender(e.target.value)}
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2.5 text-sm text-[var(--text)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors"
          >
            {GENDER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {isEdit && (regNumber || firstSeen) && (
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[var(--border)]">
            {regNumber && (
              <div>
                <p className="text-xs text-[var(--text3)] mb-1">Registration #</p>
                <p className="text-sm font-medium text-[var(--text)]">{regNumber}</p>
              </div>
            )}
            {firstSeen && (
              <div>
                <p className="text-xs text-[var(--text3)] mb-1">First seen</p>
                <p className="text-sm font-medium text-[var(--text)]">{firstSeen}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} className="flex-1" disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving} className="flex-1">
            {isEdit ? 'Save changes' : 'Add patient'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
