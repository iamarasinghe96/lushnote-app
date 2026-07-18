'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { getGroqKey } from '@/lib/utils'
import type { CustomLetterTemplate, CustomLetterSection } from '@/types'

interface Props {
  open: boolean
  initial?: CustomLetterTemplate | null   // present when editing an existing template
  onSave: (template: CustomLetterTemplate) => void
  onClose: () => void
}

// origHeading/origDescription are the values as loaded from an existing template
// (null for a brand-new row). A row is "dirty" when new or edited — only dirty
// rows get sent to the AI for cleanup, so topics the doctor already finalised are
// preserved verbatim.
interface Row { heading: string; description: string; origHeading: string | null; origDescription: string | null }

const MAX_SECTIONS = 12

function slugify(s: string, used: Set<string>): string {
  let base = s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  if (!/^[a-z]/.test(base)) base = 's_' + base
  if (base.length < 2) base = 's_' + base
  let key = base
  let n = 2
  while (used.has(key)) key = `${base}_${n++}`
  used.add(key)
  return key
}

function isDirty(r: Row): boolean {
  if (r.origHeading === null) return true // new row
  return r.heading.trim() !== r.origHeading.trim() || r.description.trim() !== (r.origDescription ?? '').trim()
}

function AutoTextarea({ value, onChange, placeholder, maxLength, className, ariaLabel }: {
  value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; className?: string; ariaLabel?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref} rows={1} value={value} maxLength={maxLength} placeholder={placeholder} aria-label={ariaLabel}
      onChange={e => onChange(e.target.value)}
      className={`resize-none overflow-hidden ${className ?? ''}`}
    />
  )
}

export default function CustomLetterBuilderModal({ open, initial, onSave, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<Row[]>([{ heading: '', description: '', origHeading: null, origDescription: null }])
  const [prompt, setPrompt] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setTitle(initial.title)
      setDescription(initial.description)
      setRows(initial.sections.length
        ? initial.sections.map(s => ({ heading: s.heading, description: s.description, origHeading: s.heading, origDescription: s.description }))
        : [{ heading: '', description: '', origHeading: null, origDescription: null }])
      setPrompt(initial.prompt)
    } else {
      setTitle('')
      setDescription('')
      setRows([{ heading: '', description: '', origHeading: null, origDescription: null }])
      setPrompt('')
    }
    setError(null)
    setWorking(false)
  }, [open, initial])

  const validRows = rows.filter(r => r.heading.trim())
  const canProceed = title.trim().length > 0 && validRows.length > 0

  function updateRow(i: number, patch: Partial<Row>) { setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function addRow() { if (rows.length < MAX_SECTIONS) setRows(prev => [...prev, { heading: '', description: '', origHeading: null, origDescription: null }]) }
  function removeRow(i: number) { setRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev) }
  function moveRow(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setRows(prev => { const next = [...prev];[next[i], next[j]] = [next[j], next[i]]; return next })
  }

  function commit(finalTitle: string, finalDesc: string, finalRows: { heading: string; description: string }[], promptText: string) {
    const used = new Set<string>()
    const sections: CustomLetterSection[] = finalRows
      .filter(r => r.heading.trim())
      .map(r => ({ key: slugify(r.heading, used), heading: r.heading.trim().slice(0, 80), description: r.description.trim().slice(0, 500) }))
    const fallbackPrompt = `Fill each section of this "${finalTitle}" letter from the doctor's dictation, in formal professional letter prose. Only include what is stated; leave a section empty if it is not covered.\n\n${sections.map(s => `- ${s.heading}: ${s.description || 'relevant content'}`).join('\n')}`
    onSave({
      id: initial?.id ?? 'ltr_' + Date.now(),
      title: finalTitle.slice(0, 100),
      description: finalDesc.slice(0, 500),
      sections,
      prompt: (promptText.trim() || fallbackPrompt).slice(0, 6000),
    })
    onClose()
  }

  // One action: clean up the new/changed topics with AI, then save. If the AI is
  // unavailable it saves as written so creation never dead-ends. When nothing has
  // changed (e.g. only reordering an existing template) it skips the AI entirely.
  async function handleRefineAndSave() {
    if (!canProceed) { setError('Add a title and at least one topic.'); return }
    const dirty = validRows.some(isDirty)
    const needAI = !initial || dirty || !prompt.trim()
    if (!needAI) { commit(title.trim(), description.trim(), validRows, prompt); return }

    setWorking(true); setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const gk = getGroqKey()
      if (gk) headers['x-groq-key'] = gk
      const res = await fetch('/api/chat', {
        method: 'POST', headers,
        body: JSON.stringify({
          type: 'letter-template', title: title.trim(), description: description.trim(),
          sections: validRows.map(r => ({ heading: r.heading, description: r.description, refine: isDirty(r) })),
        }),
      })
      const data = await res.json() as { template?: { title: string; description: string; sections: { heading: string; description: string }[]; prompt: string }; error?: string }
      if (data.template && data.template.sections?.length) {
        commit(data.template.title || title.trim(), data.template.description || description.trim(), data.template.sections, data.template.prompt || prompt)
        return
      }
      // Refine failed → save as written rather than dead-ending.
      commit(title.trim(), description.trim(), validRows, prompt)
    } catch {
      commit(title.trim(), description.trim(), validRows, prompt)
    } finally {
      setWorking(false)
    }
  }

  const HEADING_CLS = 'flex-1 min-w-0 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--blue)]'
  const DESC_CLS = 'w-full text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[var(--text2)] outline-none focus:border-[var(--blue)]'

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit letter template' : 'Create letter template'} maxWidth="md">
      <div className="px-5 pb-5 space-y-4">
        <p className="text-sm text-[var(--text2)]">
          Give your letter type a name and the topics it should cover. Saving cleans up the wording of any new or changed topics with AI and builds it into a reusable template — only you can see and use it.
        </p>

        <Input label="Title" value={title} maxLength={100} placeholder="e.g. Insurance Support Letter"
          onChange={e => setTitle(e.target.value)} />
        <Input label="Short description (optional)" value={description} maxLength={500} placeholder="What this letter is for"
          onChange={e => setDescription(e.target.value)} />

        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--text)]">Topics</p>
          {rows.map((row, i) => (
            <div key={i} className="rounded-[var(--r)] border border-[var(--border)] p-2.5 space-y-2 bg-[var(--bg)]">
              <div className="flex items-start gap-2">
                <span className="text-xs font-semibold text-[var(--text3)] w-4 shrink-0 mt-2">{i + 1}</span>
                <AutoTextarea
                  value={row.heading} maxLength={80} ariaLabel={`Topic ${i + 1} heading`}
                  onChange={v => updateRow(i, { heading: v })}
                  placeholder="Topic heading (e.g. Diagnosis)"
                  className={HEADING_CLS}
                />
                <div className="flex items-center gap-0.5 shrink-0 mt-1">
                  <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0} aria-label="Move up"
                    className="w-6 h-6 flex items-center justify-center text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"
                    className="w-6 h-6 flex items-center justify-center text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1} aria-label="Remove topic"
                    className="w-6 h-6 flex items-center justify-center text-[var(--text3)] hover:text-[var(--danger)] disabled:opacity-30">×</button>
                </div>
              </div>
              <AutoTextarea
                value={row.description} maxLength={500} ariaLabel={`Topic ${i + 1} description`}
                onChange={v => updateRow(i, { description: v })}
                placeholder="What should this topic include? (optional)"
                className={DESC_CLS}
              />
            </div>
          ))}
          {rows.length < MAX_SECTIONS && (
            <button type="button" onClick={addRow}
              className="text-xs font-medium text-[var(--blue)] hover:underline">+ Add topic</button>
          )}
        </div>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" onClick={handleRefineAndSave} disabled={!canProceed || working} className="flex-[1.4]">
            {working ? 'Refining…' : 'Refine & save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
