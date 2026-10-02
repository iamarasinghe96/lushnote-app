'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { clinicianNamesOnNotes, renameClinicianInNotes } from '@/lib/firestore/notes'

// A note keeps the clinician name it was written under, so renaming yourself in
// Settings leaves older notes showing the old name. This lists the names on the
// doctor's saved notes and moves the ones they tick onto their current name.
// Only the name just replaced starts ticked: a different name on a note may be
// a colleague's, written on their behalf, and must not change unasked.

interface Props {
  open: boolean
  onClose: () => void
  uid: string
  currentName: string
  /** The display name just replaced, ticked by default. */
  previousName?: string | null
  onToast: (msg: string) => void
}

export default function ClinicianRenameModal({ open, onClose, uid, currentName, previousName, onToast }: Props) {
  const [names, setNames] = useState<{ name: string; count: number }[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setNames(null)
    setLoadError(false)
    clinicianNamesOnNotes(uid)
      .then(all => {
        if (cancelled) return
        const others = all.filter(n => n.name !== currentName)
        setNames(others)
        setPicked(new Set(others.filter(n => n.name === previousName?.trim()).map(n => n.name)))
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [open, uid, currentName, previousName])

  const pickedCount = (names ?? []).filter(n => picked.has(n.name)).reduce((s, n) => s + n.count, 0)

  function toggle(name: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function update() {
    setWorking(true)
    try {
      let total = 0
      for (const name of Array.from(picked)) total += await renameClinicianInNotes(uid, name, currentName)
      onToast(`Updated ${total} ${total === 1 ? 'note' : 'notes'}`)
      onClose()
    } catch {
      onToast('Could not update every note. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal open={open} onClose={() => !working && onClose()} title="Update name on saved notes">
      <div className="px-5 pb-5 space-y-4">
        <p className="text-sm text-[var(--text2)]">
          Each note keeps the clinician name it was saved with. Tick the names to change
          to <strong className="text-[var(--text)]">{currentName}</strong>. Names you leave unticked stay as they are.
        </p>

        {loadError ? (
          <p className="text-sm text-[var(--danger)]">Could not read your notes. Please try again.</p>
        ) : names === null ? (
          <p className="text-sm text-[var(--text3)]">Checking your saved notes…</p>
        ) : names.length === 0 ? (
          <p className="text-sm text-[var(--text2)]">Every saved note already shows {currentName}.</p>
        ) : (
          <div className="rounded-[var(--r)] border border-[var(--border)] divide-y divide-[var(--border)] max-h-64 overflow-y-auto">
            {names.map(n => (
              <label key={n.name} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[var(--bg)]">
                <input
                  type="checkbox"
                  checked={picked.has(n.name)}
                  onChange={() => toggle(n.name)}
                  className="w-4 h-4 accent-[var(--blue)] shrink-0"
                />
                <span className="flex-1 min-w-0 text-sm text-[var(--text)] truncate">{n.name}</span>
                <span className="text-xs text-[var(--text3)] shrink-0">
                  {n.count} {n.count === 1 ? 'note' : 'notes'}
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={working}>
            {names && names.length === 0 ? 'Close' : 'Not now'}
          </Button>
          {names && names.length > 0 && (
            <Button variant="primary" size="sm" onClick={update} loading={working} disabled={pickedCount === 0}>
              {pickedCount ? `Update ${pickedCount} ${pickedCount === 1 ? 'note' : 'notes'}` : 'Update notes'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
