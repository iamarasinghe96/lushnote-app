'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { reauthenticateWithPopup, GoogleAuthProvider, deleteUser } from 'firebase/auth'
import {
  collection, doc, getDocs, setDoc, serverTimestamp,
  query, where, writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { deleteProfile, updateProfile } from '@/lib/firestore/profiles'
import { uploadSignatureSVG } from '@/lib/storage'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignatureUploader from '@/components/ui/SignatureUploader'
import { useAuth } from '@/hooks/useAuth'
import type { User } from '@/types'

interface ProfilePanelProps {
  profile: User
  uid: string
  onSave: (data: Partial<User>) => Promise<void>
  onToast: (msg: string) => void
}

const DELETE_REASONS = [
  'Security Concerns',
  'Privacy Concerns',
  'App Crashed / Bugs',
  'Difficult to Use',
  'Templates Not Working',
  'Unsatisfied with AI Output',
  'Missing Features',
  'Too Complex',
  'Switching to Another Tool',
  'No Longer Need the App',
  'Other',
]

export default function ProfilePanel({ profile, uid, onSave, onToast }: ProfilePanelProps) {
  const router = useRouter()
  const { user } = useAuth()
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [credentials, setCredentials] = useState(profile.credentials ?? '')
  const [position, setPosition] = useState(profile.position ?? '')
  const [providerNumber, setProviderNumber] = useState(profile.providerNumber ?? '')
  const [workPhone, setWorkPhone] = useState(profile.workPhone ?? '')
  const [emailPretext, setEmailPretext] = useState(profile.emailPretext ?? '')
  const [saving, setSaving] = useState(false)
  const [sigSaving, setSigSaving] = useState(false)
  const [localSignatureUrl, setLocalSignatureUrl] = useState<string | null>(profile.signatureUrl ?? null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectedReasons, setSelectedReasons] = useState<string[]>([])
  const [deleteMessage, setDeleteMessage] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        displayName: displayName.trim(),
        credentials: credentials.trim(),
        position: position.trim(),
        providerNumber: providerNumber.trim(),
        workPhone: workPhone.trim(),
        emailPretext,
      })
      onToast('Profile saved')
    } catch {
      onToast('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  async function handleSignatureSave(svgDataUrl: string) {
    setSigSaving(true)
    try {
      const url = await uploadSignatureSVG(uid, svgDataUrl)
      await updateProfile(uid, { signatureUrl: url })
      setLocalSignatureUrl(url)
      onToast('Signature saved')
    } catch {
      onToast('Failed to save signature')
    } finally {
      setSigSaving(false)
    }
  }

  function toggleReason(r: string) {
    setSelectedReasons(prev =>
      prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]
    )
  }

  async function handleDeleteAccount() {
    if (!user) return
    setDeleting(true)

    // Step 1 - Re-authenticate via Google popup (NOT redirect)
    try {
      await reauthenticateWithPopup(user, new GoogleAuthProvider())
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'auth/popup-blocked') {
        onToast('Please allow popups for this site and try again.')
      } else {
        onToast('Re-authentication failed. Please try again.')
      }
      setDeleting(false)
      return
    }

    // Step 2 - Save deletion feedback
    try {
      await setDoc(doc(db, 'deletion_feedback', uid), {
        userId: uid,
        email: user.email,
        reasons: selectedReasons,
        message: deleteMessage,
        deletedAt: serverTimestamp(),
      })
    } catch (_) { /* non-fatal */ }

    // Step 3 - Batch delete progress_notes
    try {
      const snap = await getDocs(query(collection(db, 'progress_notes'), where('userId', '==', uid)))
      const chunks: (typeof snap.docs[number])[][] = []
      snap.docs.forEach((d, i) => {
        if (i % 500 === 0) chunks.push([])
        chunks[chunks.length - 1].push(d)
      })
      for (const chunk of chunks) {
        const batch = writeBatch(db)
        chunk.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
    } catch (_) {}

    // Step 4 - Delete patientProfiles subcollection
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'patientProfiles'))
      const batch = writeBatch(db)
      snap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
    } catch (_) {}

    // Step 5 - Delete user document
    try { await deleteProfile(uid) } catch (_) {}

    // Step 6 - Delete Firebase Auth account
    try { await deleteUser(user) } catch (_) {}

    // Step 7 - Clear session storage
    sessionStorage.removeItem('groq_api_key')
    sessionStorage.removeItem('gemini_api_key')

    // Step 8 - Navigate to confirmation page
    router.push('/account-deleted')
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Signed in as */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)]">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
          <path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
          <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2c-7.6 0-14.2 4.2-17.7 10.7z"/>
          <path fill="#FBBC05" d="M24 46c5.8 0 10.7-1.9 14.3-5.2l-6.6-5.4C29.9 37 27.1 38 24 38c-6.1 0-11.2-4.1-13.1-9.7l-7 5.4C7.7 41.8 15.3 46 24 46z"/>
          <path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3.1-3.3 5.6-6.4 7.1l6.6 5.4C41.6 37.3 45 31.1 45 24c0-1.3-.2-2.7-.5-4z"/>
        </svg>
        <span className="text-sm text-[var(--text2)]">Signed in as</span>
        <span className="text-sm font-medium text-[var(--text)] truncate">{user?.email}</span>
      </div>

      <Input
        label="Display name"
        value={displayName}
        onChange={e => setDisplayName(e.target.value)}
        placeholder="e.g. Dr Jane Smith"
      />
      <Input
        label="Credentials"
        value={credentials}
        onChange={e => setCredentials(e.target.value)}
        placeholder="e.g. FRANZCP, MBChB"
      />
      <Input
        label="Position / Title"
        value={position}
        onChange={e => setPosition(e.target.value)}
        placeholder="e.g. Consultant Psychiatrist"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Provider Number"
          value={providerNumber}
          onChange={e => setProviderNumber(e.target.value)}
          placeholder="e.g. 2345678B"
        />
        <Input
          label="Work Phone"
          value={workPhone}
          onChange={e => setWorkPhone(e.target.value)}
          placeholder="e.g. (02) 6058 4444"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--text)] mb-1">
          Email opening line
        </label>
        <textarea
          value={emailPretext}
          onChange={e => setEmailPretext(e.target.value)}
          rows={4}
          placeholder="Dear colleague, please find below a summary of the patient discussed…"
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors resize-none"
        />
      </div>

      <Button variant="primary" onClick={handleSave} loading={saving}>
        Save profile
      </Button>

      {/* Signature section */}
      <div>
        <label className="block text-sm font-medium text-[var(--text)] mb-1">
          Signature
        </label>
        <p className="text-xs text-[var(--text2)] mb-3">
          Upload a photo of your handwritten signature. The ink lines will be traced and saved as a vector image for use in letters.
        </p>
        <SignatureUploader
          existingUrl={localSignatureUrl}
          onSave={handleSignatureSave}
          saving={sigSaving}
        />
        <p className="text-xs text-[var(--text3)] mt-2">
          Adjust the signature size on a letter in the Edit tab — the change previews live and saves to your profile.
        </p>
      </div>

      {/* Delete account danger card */}
      <div className="border border-[var(--danger)]/30 rounded-[var(--r-lg)] p-4 mt-8">
        <p className="text-sm font-semibold text-[var(--danger)] mb-1">Delete account</p>
        <p className="text-xs text-[var(--text2)] mb-3">
          Permanently deletes all your notes, patients, and account data.
          This cannot be undone.
        </p>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        title="Delete your account"
      >
        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-[var(--text2)]">
            This cannot be undone. All notes and patient data will be permanently erased.
          </p>

          <div className="flex flex-wrap gap-2">
            {DELETE_REASONS.map(r => (
              <button
                key={r}
                onClick={() => toggleReason(r)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                  ${selectedReasons.includes(r)
                    ? 'bg-[var(--danger)] text-white border-[var(--danger)]'
                    : 'bg-white text-[var(--text2)] border-[var(--border)] hover:border-[var(--danger)]/50'}`}
              >
                {r}
              </button>
            ))}
          </div>

          <textarea
            value={deleteMessage}
            onChange={e => setDeleteMessage(e.target.value)}
            rows={3}
            placeholder="Anything else you'd like to share?"
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors resize-none"
          />

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteAccount}
              loading={deleting}
              disabled={selectedReasons.length === 0}
              className="flex-1"
            >
              Confirm & Delete Account
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
