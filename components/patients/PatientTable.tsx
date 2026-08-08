'use client'

import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react'
import { TRACKED_CLINICAL_FIELDS, formatDob, buildPatientInfoText, patientOtherTopics } from '@/lib/utils'
import type { PatientProfile } from '@/types'

interface PatientTableProps {
  profiles: PatientProfile[]
  onSave: (id: string, patch: Partial<PatientProfile>) => void
  onGenerate: (profile: PatientProfile) => void
  onDelete: (profile: PatientProfile) => void
}

type CapMode = 'none' | 'words' | 'sentences'
type Col = { key: keyof PatientProfile; label: string; minCh: number; cap: CapMode; numeric?: boolean; format?: (v: string) => string }

// Editable columns, left to right. Name is a separate sticky identity column.
// `cap` drives smart capitalisation; `numeric` shows the number keyboard; DOB
// auto-inserts the DD/MM/YYYY slashes.
const COLUMNS: Col[] = [
  { key: 'urNumber', label: 'UR', minCh: 10, cap: 'none', numeric: true },
  { key: 'status', label: 'Status', minCh: 12, cap: 'sentences' },
  ...TRACKED_CLINICAL_FIELDS.map(f => ({
    key: f.key,
    label: f.label,
    minCh: f.key === 'dob' || f.key === 'bedNumber' ? 10 : 22,
    cap: (f.key === 'dob' ? 'none' : 'sentences') as CapMode,
    ...(f.key === 'dob' ? { numeric: true, format: formatDob } : {}),
  })),
  // Everything the note covered that has no column of its own, listed as
  // "Heading: content" — one column instead of one per topic, which would make
  // the table unusably wide.
  { key: 'otherTopics', label: 'Other topics', minCh: 28, cap: 'sentences' },
]

// Download the currently-shown patients as a clean, printable A4 PDF (one titled
// block per patient). jsPDF is code-split so it only loads when exporting.
async function exportPatientsPDF(rows: PatientProfile[]) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const MARGIN = 15
  const PAGE_W = 210
  const PAGE_H = 297
  const TEXT_W = PAGE_W - MARGIN * 2
  let y = MARGIN

  const ensure = (needed: number) => { if (y + needed > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN } }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(15, 23, 42)
  doc.text('Patient List', MARGIN, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139)
  const now = new Date()
  doc.text(`${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} · ${rows.length} patient${rows.length !== 1 ? 's' : ''}`, MARGIN, y)
  y += 8

  const fields: { label: string; key: keyof PatientProfile }[] = [
    { label: 'UR', key: 'urNumber' },
    { label: 'Status', key: 'status' },
    ...TRACKED_CLINICAL_FIELDS.map(f => ({ label: f.label, key: f.key })),
  ]

  rows.forEach((p, i) => {
    ensure(12)
    if (i > 0) { doc.setDrawColor(226, 232, 240); doc.line(MARGIN, y - 3, PAGE_W - MARGIN, y - 3) }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(15, 23, 42)
    doc.text(p.displayName || 'Unnamed', MARGIN, y); y += 6

    const allFields: { label: string; value: string }[] = [
      ...fields.map(f => ({ label: f.label, value: typeof p[f.key] === 'string' ? String(p[f.key]).trim() : '' })),
      { label: 'Other topics', value: patientOtherTopics(p).trim() },
    ]
    for (const f of allFields) {
      const value = f.value
      if (!value) continue
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(71, 85, 105)
      doc.text(`${f.label}:`, MARGIN, y)
      const labelW = doc.getTextWidth(`${f.label}: `) + 1
      doc.setFont('helvetica', 'normal'); doc.setTextColor(15, 23, 42)
      const lines = doc.splitTextToSize(value, TEXT_W - labelW) as string[]
      lines.forEach((ln, li) => {
        ensure(5)
        doc.text(ln, li === 0 ? MARGIN + labelW : MARGIN + labelW, y)
        y += 4.5
      })
      y += 1
    }
    y += 4
  })

  doc.save(`patients-${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}.pdf`)
}

// A textarea that grows to fit its content (the "auto stretching textbox").
function GrowCell({
  value, onChange, onFlush, minCh, cap, numeric,
}: { value: string; onChange: (v: string) => void; onFlush: () => void; minCh: number; cap: CapMode; numeric?: boolean }) {
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
      inputMode={numeric ? 'numeric' : undefined}
      autoCapitalize={cap}
      autoCorrect="on"
      spellCheck
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
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Search suggestions — clickable name chips so the doctor can pick the searched
  // patient (dismisses the keyboard + selects them) without hunting for a checkbox
  // (which is hidden once a single result is focused).
  const matches = useMemo(() => {
    if (!q) return []
    return profiles
      .filter(p => p.displayName.toLowerCase().includes(q) || (p.urNumber ?? '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [profiles, q])

  function selectMatch(p: PatientProfile) {
    if (p.id) setSelected(prev => new Set(prev).add(p.id!))
    setSearch('')
    searchRef.current?.blur()
  }

  function flush(id: string) {
    const patch = pendingRef.current[id]
    if (patch && Object.keys(patch).length) {
      onSave(id, patch)
      pendingRef.current[id] = {}
    }
    if (timerRef.current[id]) { clearTimeout(timerRef.current[id]); delete timerRef.current[id] }
  }

  // Copy a patient's fields as plain "Topic: Content" lines (only filled ones),
  // including any unsaved edits currently in the draft overlay.
  async function copyRow(p: PatientProfile) {
    const merged = p.id && drafts[p.id] ? { ...p, ...drafts[p.id] } : p
    const text = buildPatientInfoText(merged)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    if (p.id) {
      setCopiedId(p.id)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopiedId(null), 1600)
    }
  }

  function editCell(id: string, key: keyof PatientProfile, value: string) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }))
    pendingRef.current[id] = { ...pendingRef.current[id], [key]: value }
    if (timerRef.current[id]) clearTimeout(timerRef.current[id])
    timerRef.current[id] = setTimeout(() => flush(id), 800)
  }

  // Suppress the browser's pull-to-refresh while the doctor is in the table view
  // so panning/scrolling the wide grid can't accidentally reload the page.
  // Restored to whatever it was when the table unmounts.
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const prevHtml = html.style.overscrollBehaviorY
    const prevBody = body.style.overscrollBehaviorY
    html.style.overscrollBehaviorY = 'none'
    body.style.overscrollBehaviorY = 'none'
    return () => {
      html.style.overscrollBehaviorY = prevHtml
      body.style.overscrollBehaviorY = prevBody
    }
  }, [])

  // Safari ignores overscroll-behavior for its pull-to-refresh, so also block the
  // gesture directly. A listener on an ancestor doesn't reliably stop the inner
  // scroller's overscroll, so bind at the DOCUMENT in the CAPTURE phase (fires
  // before the scroller handles the move) and act only for touches inside the
  // table view: when the grid can't scroll up any further and the finger drags
  // DOWN (a mostly-vertical move), swallow it. Horizontal panning and scrolling
  // up/down within the grid are untouched.
  useEffect(() => {
    let startY = 0, startX = 0
    const onStart = (e: TouchEvent) => { const t = e.touches[0]; startY = t.clientY; startX = t.clientX }
    const onMove = (e: TouchEvent) => {
      const root = rootRef.current
      if (!root || !e.cancelable) return
      if (!root.contains(e.target as Node)) return
      const sc = scrollRef.current
      const t = e.touches[0]
      const dy = t.clientY - startY
      const dx = t.clientX - startX
      const atTop = !sc || sc.scrollTop <= 0
      if (atTop && dy > 0 && dy > Math.abs(dx)) e.preventDefault()
    }
    document.addEventListener('touchstart', onStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onMove, { passive: false, capture: true })
    return () => {
      document.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions)
      document.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions)
    }
  }, [])

  // Flush everything on unmount so nothing typed is lost on navigation.
  useEffect(() => {
    const timers = timerRef.current
    const pending = pendingRef.current
    return () => {
      Object.keys(timers).forEach(id => clearTimeout(timers[id]))
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      Object.entries(pending).forEach(([id, patch]) => {
        if (patch && Object.keys(patch).length) onSave(id, patch)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cellValue(p: PatientProfile, key: keyof PatientProfile): string {
    const d = p.id ? drafts[p.id] : undefined
    if (d && key in d) return String(d[key] ?? '')
    if (key === 'otherTopics') return patientOtherTopics(p)
    const v = p[key]
    return typeof v === 'string' ? v : ''
  }

  function toggle(id: string) {
    const nowChecked = !selected.has(id)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    // Checking a searched patient focuses the table on the checked set: clear the
    // search so only the checked rows remain.
    if (nowChecked && search.trim()) setSearch('')
  }

  const allIds = useMemo(() => profiles.map(p => p.id).filter(Boolean) as string[], [profiles])
  const checkAll = () => setSelected(new Set(allIds))
  const uncheckAll = () => setSelected(new Set())

  // When the table is down to a single patient, drop the frozen name column and
  // surface that patient's name in the toolbar instead — freeing horizontal room
  // for their clinical fields.
  const singleFocus = rows.length === 1 ? rows[0] : null

  return (
    <div ref={rootRef} className="flex flex-col h-full overflow-hidden pb-tabbar">
      {/* Controls */}
      <div className="shrink-0 px-4 py-2 flex items-center gap-2 flex-wrap border-b border-[var(--border)] bg-white/70">
        <input
          ref={searchRef}
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
        <button
          onClick={() => exportPatientsPDF(rows)}
          disabled={rows.length === 0}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[#10b981]/50
                     text-[#059669] font-medium hover:bg-[#10b981]/10 disabled:opacity-40
                     active:scale-95 transition-all"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          PDF
        </button>
        {/* Searching → tap a blue name button to select that patient (dismisses
            the keyboard). Once selected, it stays a blue button where the name
            shows. */}
        {q && matches.length > 0 ? (
          matches.map(p => (
            <button
              key={p.id}
              onClick={() => selectMatch(p)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[var(--blue)] text-white
                         font-medium hover:bg-[var(--blue-dk)] active:scale-95 transition-all"
            >
              {p.displayName}
              {p.urNumber && <span className="opacity-70">#{p.urNumber}</span>}
            </button>
          ))
        ) : singleFocus ? (
          <span className="flex items-center text-xs px-3 py-1.5 rounded-full bg-[var(--blue)] text-white font-medium max-w-full truncate">
            {singleFocus.displayName}
          </span>
        ) : (
          <span className="text-xs text-[var(--text3)]">{rows.length} shown</span>
        )}
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
        <div ref={scrollRef} className="flex-1 overflow-auto overscroll-contain ln-table-scroll">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="text-left">
                {!singleFocus && (
                  <th className="sticky left-0 top-0 z-20 w-24 bg-[var(--bg)] border-b border-r border-[var(--border)] px-1.5 py-2 font-semibold text-xs text-[var(--text3)] uppercase tracking-wide">
                    Patient
                  </th>
                )}
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
                  {/* Sticky identity cell: checkbox + name (hidden when focused on one patient) */}
                  {!singleFocus && (
                    <td className="sticky left-0 z-10 w-24 bg-white border-b border-r border-[var(--border)] px-1.5 py-2">
                      <div className="flex items-start gap-1.5 w-24">
                        <input
                          type="checkbox"
                          checked={p.id ? selected.has(p.id) : false}
                          onChange={() => p.id && toggle(p.id)}
                          className="mt-0.5 accent-[var(--blue)] shrink-0"
                          aria-label={`Show ${p.displayName} in table`}
                        />
                        <span className="flex-1 min-w-0 text-[13px] font-semibold text-[var(--text)] leading-tight break-words line-clamp-2">{p.displayName}</span>
                      </div>
                    </td>
                  )}
                  {COLUMNS.map(c => (
                    <td key={c.key as string} className="border-b border-[var(--border)] px-1.5 py-1.5">
                      <GrowCell
                        value={cellValue(p, c.key)}
                        onChange={v => p.id && editCell(p.id, c.key, c.format ? c.format(v) : v)}
                        onFlush={() => p.id && flush(p.id)}
                        minCh={c.minCh}
                        cap={c.cap}
                        numeric={c.numeric}
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
                        onClick={() => copyRow(p)}
                        title="Copy details"
                        className={`shrink-0 w-8 h-8 rounded-[var(--r-sm)] border flex items-center justify-center active:scale-95 transition-all
                          ${p.id && copiedId === p.id
                            ? 'border-[#10b981] text-[#10b981] bg-[#10b981]/10'
                            : 'border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)]'}`}
                        aria-label={`Copy ${p.displayName}'s details`}
                      >
                        {p.id && copiedId === p.id ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <rect x="9" y="9" width="11" height="11" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                          </svg>
                        )}
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
