'use client'

import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import { TRACKED_CLINICAL_FIELDS } from '@/lib/utils'
import type { PatientProfile } from '@/types'

interface PatientTableProps {
  profiles: PatientProfile[]
  onSave: (id: string, patch: Partial<PatientProfile>) => void
  onGenerate: (profile: PatientProfile) => void
  onDelete: (profile: PatientProfile) => void
}

// Editable columns, left to right. Name is a separate sticky identity column.
const COLUMNS: { key: keyof PatientProfile; label: string; minCh: number }[] = [
  { key: 'urNumber', label: 'UR', minCh: 10 },
  { key: 'status', label: 'Status', minCh: 12 },
  ...TRACKED_CLINICAL_FIELDS.map(f => ({ key: f.key, label: f.label, minCh: f.key === 'dob' || f.key === 'bedNumber' ? 10 : 22 })),
]

// A textarea that grows to fit its content (the "auto stretching textbox").
function GrowCell({
  value, onChange, onFlush, minCh,
}: { value: string; onChange: (v: string) => void; onFlush: () => void; minCh: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  function resize() {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={e => { onChange(e.target.value); resize() }}
      onBlur={onFlush}
      maxLength={6000}
      className="w-full resize-none overflow-hidden bg-transparent text-sm text-[var(--text)]
                 leading-snug outline-none placeholder:text-[var(--text3)]
                 focus:bg-[var(--blue-lt)]/40 rounded px-1 py-0.5 transition-colors"
      style={{ minWidth: `${minCh}ch` }}
    />
  )
}

export default function PatientTable({ profiles, onSave, onGenerate, onDelete }: PatientTableProps) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Per-row local edits overlaid on the profile, so typing stays responsive and
  // the debounced save doesn't fight the input.
  const [drafts, setDrafts] = useState<Record<string, Partial<PatientProfile>>>({})
  const pendingRef = useRef<Record<string, Partial<PatientProfile>>>({})
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const seenRef = useRef<Set<string>>(new Set())

  // Keep newly-added patients visible (union their ids into the selection) while
  // preserving any rows the doctor deliberately unchecked.
  useEffect(() => {
    setSelected(prev => {
      const next = new Set(prev)
      let changed = false
      for (const p of profiles) {
        if (!p.id) continue
        if (!seenRef.current.has(p.id)) { seenRef.current.add(p.id); next.add(p.id); changed = true }
      }
      return changed ? next : prev
    })
  }, [profiles])

  const q = search.trim().toLowerCase()
  const rows = useMemo(() => {
    const matches = (p: PatientProfile) =>
      !q || p.displayName.toLowerCase().includes(q) || (p.urNumber ?? '').toLowerCase().includes(q)
    // Searching reveals ALL matches (so any patient can be re-checked); otherwise
    // the table shows only the checked (selected) patients.
    return profiles.filter(p => (q ? matches(p) : (p.id ? selected.has(p.id) : true)))
  }, [profiles, q, selected])

  function flush(id: string) {
    const patch = pendingRef.current[id]
    if (patch && Object.keys(patch).length) {
      onSave(id, patch)
      pendingRef.current[id] = {}
    }
    if (timerRef.current[id]) { clearTimeout(timerRef.current[id]); delete timerRef.current[id] }
  }

  function editCell(id: string, key: keyof PatientProfile, value: string) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
    pendingRef.current[id] = { ...pendingRef.current[id], [key]: value }
    if (timerRef.current[id]) clearTimeout(timerRef.current[id])
    timerRef.current[id] = setTimeout(() => flush(id), 800)
  }

  // Flush everything on unmount so nothing typed is lost on navigation.
  useEffect(() => {
    const timers = timerRef.current
    const pending = pendingRef.current
    return () => {
      Object.keys(timers).forEach(id => clearTimeout(timers[id]))
      Object.entries(pending).forEach(([id, patch]) => {
        if (patch && Object.keys(patch).length) onSave(id, patch)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cellValue(p: PatientProfile, key: keyof PatientProfile): string {
    const d = p.id ? drafts[p.id] : undefined
    if (d && key in d) return String(d[key] ?? '')
    const v = p[key]
    return typeof v === 'string' ? v : ''
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const allIds = useMemo(() => profiles.map(p => p.id).filter(Boolean) as string[], [profiles])
  const checkAll = () => setSelected(new Set(allIds))
  const uncheckAll = () => setSelected(new Set())

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Controls */}
      <div className="shrink-0 px-4 py-2 flex items-center gap-2 flex-wrap border-b border-[var(--border)] bg-white/70">
        <input
          type="text"
          placeholder="Search to find & check patients…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-1.5
                     bg-white outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
        />
        <button
          onClick={checkAll}
          className="text-xs px-3 py-1.5 rounded-full border border-[var(--border)] text-[var(--text2)]
                     hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors"
        >
          Check all
        </button>
        <button
          onClick={uncheckAll}
          className="text-xs px-3 py-1.5 rounded-full border border-[var(--border)] text-[var(--text2)]
                     hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors"
        >
          Uncheck all
        </button>
        <span className="text-xs text-[var(--text3)]">{selected.size} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-sm text-[var(--text3)] max-w-xs">
            {profiles.length === 0
              ? 'No tracked patients yet. Use “+ Add Patient” to dictate a reading note, or add a UR number to an existing patient.'
              : q
                ? 'No patients match your search.'
                : 'No patients are checked. Search to find and check patients, or tap “Check all”.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto scrollbar-none pb-tabbar">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="sticky left-0 top-0 z-20 bg-[var(--bg)] border-b border-r border-[var(--border)] px-2 py-2 font-semibold text-xs text-[var(--text3)] uppercase tracking-wide">
                  Patient
                </th>
                {COLUMNS.map(c => (
                  <th key={c.key as string} className="sticky top-0 z-10 bg-[var(--bg)] border-b border-[var(--border)] px-2 py-2 font-semibold text-xs text-[var(--text3)] uppercase tracking-wide whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-[var(--bg)] border-b border-[var(--border)] px-2 py-2 font-semibold text-xs text-[var(--text3)] uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="align-top hover:bg-[var(--bg)]/60">
                  {/* Sticky identity cell: checkbox + name */}
                  <td className="sticky left-0 z-10 bg-white border-b border-r border-[var(--border)] px-2 py-2">
                    <div className="flex items-start gap-2 min-w-[140px]">
                      <input
                        type="checkbox"
                        checked={p.id ? selected.has(p.id) : false}
                        onChange={() => p.id && toggle(p.id)}
                        className="mt-1 accent-[var(--blue)] shrink-0"
                        aria-label={`Show ${p.displayName} in table`}
                      />
                      <span className="text-sm font-semibold text-[var(--text)] leading-snug">{p.displayName}</span>
                    </div>
                  </td>
                  {COLUMNS.map(c => (
                    <td key={c.key as string} className="border-b border-[var(--border)] px-1.5 py-1.5">
                      <GrowCell
                        value={cellValue(p, c.key)}
                        onChange={v => p.id && editCell(p.id, c.key, v)}
                        onFlush={() => p.id && flush(p.id)}
                        minCh={c.minCh}
                      />
                    </td>
                  ))}
                  <td className="border-b border-[var(--border)] px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onGenerate(p)}
                        className="text-xs bg-[#10b981] text-white px-3 py-1.5 rounded-[var(--r-sm)] font-medium
                                   hover:bg-[#059669] active:scale-95 transition-all"
                      >
                        Generate
                      </button>
                      <button
                        onClick={() => onDelete(p)}
                        className="text-xs border border-[var(--danger)] text-[var(--danger)] px-2.5 py-1.5 rounded-[var(--r-sm)]
                                   font-medium hover:bg-red-50 active:scale-95 transition-all"
                        aria-label={`Delete ${p.displayName}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
