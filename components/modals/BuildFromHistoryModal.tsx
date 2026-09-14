'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { historySelectionProblem, sortHistorySources, type HistorySource } from '@/lib/buildFromHistory'

interface Props {
  open: boolean
  patientName: string
  sources: HistorySource[]
  onClose: () => void
  onContinue: (sources: HistorySource[]) => void
}

export default function BuildFromHistoryModal({ open, patientName, sources, onClose, onContinue }: Props) {
  const available = useMemo(() => sortHistorySources(sources).reverse(), [sources])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    // Choosing the episode is a clinical decision. Preselecting recent records
    // would let an old admission enter the draft without a deliberate gesture.
    setSelected(new Set())
  }, [open, available])

  const chosen = available.filter(note => selected.has(note.id!))
  const problem = historySelectionProblem(chosen)

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Modal open={open} onClose={onClose} title="Build from history" maxWidth="lg">
      <div className="px-5 pb-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{patientName}</p>
          <p className="text-xs text-[var(--text3)] mt-1">
            Select the documents that belong to this episode. Nothing outside this selection will be sent for generation.
          </p>
        </div>

        {available.length < 2 ? (
          <div className="rounded-[var(--r)] border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
            At least two saved sources with content are needed to build from history.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text3)]">Source documents</p>
              <button
                type="button"
                onClick={() => setSelected(selected.size === available.length ? new Set() : new Set(available.map(note => note.id!)))}
                className="text-xs font-medium text-[var(--blue)]"
              >
                {selected.size === available.length ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-[42dvh] overflow-y-auto space-y-2 pr-1">
              {available.map(note => {
                const checked = selected.has(note.id)
                const excerpt = note.text.replace(/\s+/g, ' ').slice(0, 120)
                return (
                  <label
                    key={note.id}
                    className={`flex gap-3 rounded-[var(--r)] border p-3 cursor-pointer transition-colors ${checked ? 'border-[var(--blue)] bg-[var(--blue-lt)]' : 'border-[var(--border)] bg-white'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(note.id)}
                      className="mt-0.5 h-4 w-4 accent-[var(--blue)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--text)] truncate">{note.templateName || note.documentType}</span>
                        <span className="text-xs text-[var(--text3)] shrink-0">{note.date || 'No date'}</span>
                      </span>
                      <span className="mt-1 block text-xs text-[var(--text2)] line-clamp-2">{excerpt}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="rounded-[var(--r)] border border-[var(--border)] bg-white px-3 py-2">
          <p className="text-xs font-medium text-[var(--text)]">{chosen.length} sources selected</p>
          <p className="text-xs text-[var(--text3)] mt-0.5">
            {problem ?? 'You will choose the document template next. The result remains a draft for your review.'}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!!problem} onClick={() => onContinue(chosen)} title={problem ?? undefined}>
            Choose template
          </Button>
        </div>
      </div>
    </Modal>
  )
}
