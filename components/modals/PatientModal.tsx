'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { savePatientProfile } from '@/lib/firestore/patients'
import { useAuth } from '@/hooks/useAuth'
import type { PatientProfile } from '@/types'

interface PatientModalProps {
  open: boolean
  patient?: PatientProfile
  onSave: (profile: PatientProfile) => void
  onClose: () => void
}

function dobInputToStored(value: string): string {
  // input type=date yields YYYY-MM-DD; store as DD/MM/YYYY
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

function storedToDobInput(dob: string): string {
  // DD/MM/YYYY → YYYY-MM-DD for input type=date
  if (!dob) return ''
  const [d, m, y] = dob.split('/')
  if (!y) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

const GENDER_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
] as const

export default function PatientModal({ open, patient, onSave, onClose }: PatientModalProps) {
  const { user } = useAuth()
  const isEdit = !!patient

  const [displayName, setDisplayName] = useState(patient?.displayName ?? '')
  const [dobInput, setDobInput] = useState(storedToDobInput(patient?.dob ?? ''))
  const [gender, setGender] = useState<string>(patient?.gender ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Reset form when modal opens for a new patient
  function handleOpen() {
    setDisplayName(patient?.displayName ?? '')
    setDobInput(storedToDobInput(patient?.dob ?? ''))
    setGender(patient?.gender ?? '')
    setNameError(null)
  }

  // Sync form state when `patient` prop changes (open in edit mode)
  useState(() => { if (open) handleOpen() })

  async function handleSave() {
    const trimmed = displayName.trim()
    if (!trimmed) { setNameError('Name is required'); return }
    if (!user) return
    setSaving(true)
    try {
      const profile: PatientProfile = {
        ...(patient?.id ? { id: patient.id } : {}),
        displayName: trimmed,
        ...(dobInput ? { dob: dobInputToStored(dobInput) } : {}),
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
            type="date"
            value={dobInput}
            onChange={e => setDobInput(e.target.value)}
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2.5 text-sm text-[var(--text)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors"
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
