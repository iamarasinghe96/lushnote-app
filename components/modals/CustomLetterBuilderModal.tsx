'use client'

import { useState, useEffect } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import { getGroqKey } from '@/lib/utils'
import type { CustomLetterTemplate, CustomLetterSection } from '@/types'

interface Props {
  open: boolean
  initial?: CustomLetterTemplate | null   // present when editing an existing template
  onSave: (template: CustomLetterTemplate) => void
  onClose: () => void
}

interface Row { heading: string; description: string }

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

export default function CustomLetterBuilderModal({ open, initial, onSave, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<Row[]>([{ heading: '', description: '' }])
  const [prompt, setPrompt] = useState('')
  const [refined, setRefined] = useState(false)
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (initial) {
      setTitle(initial.title)
      setDescription(initial.description)
      setRows(initial.sections.length ? initial.sections.map(s => ({ heading: s.heading, description: s.description })) : [{ heading: '', description: '' }])
      setPrompt(initial.prompt)
      setRefined(!!initial.prompt)
    } else {
      setTitle('')
      setDescription('')
      setRows([{ heading: '', description: '' }])
      setPrompt('')
      setRefined(false)
    }
    setError(null)
    setRefining(false)
  }, [open, initial])

  const validRows = rows.filter(r => r.heading.trim())
  const canProceed = title.trim().length > 0 && validRows.length > 0

  function updateRow(i: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r))
    setRefined(false)
  }
  function addRow() { if (rows.length < MAX_SECTIONS) setRows(prev => [...prev, { heading: '', description: '' }]) }
  function removeRow(i: number) { setRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev) }
  function moveRow(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setRows(prev => { const next = [...prev];[next[i], next[j]] = [next[j], next[i]]; return next })
  }

  async function handleRefine() {
    if (!canProceed) { setError('Add a title and at least one topic first.'); return }
    setRefining(true); setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const gk = getGroqKey()
      if (gk) headers['x-groq-key'] = gk
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'letter-template', title: title.trim(), description: description.trim(), sections: validRows }),
      })
      const data = await res.json() as { template?: { title: string; description: string; sections: Row[]; prompt: string }; error?: string }
      if (data.template && data.template.sections?.length) {
        setTitle(data.template.title || title)
        setDescription(data.template.description || description)
        setRows(data.template.sections.map(s => ({ heading: s.heading, description: s.description })))
        setPrompt(data.template.prompt || '')
        setRefined(true)
      } else {
        setError(data.error || 'Could not refine — you can still save it as written.')
      }
    } catch {
      setError('Could not reach the AI — you can still save it as written.')
    } finally {
      setRefining(false)
    }
  }

  function handleSave() {
    if (!canProceed) { setError('Add a title and at least one topic.'); return }
    const used = new Set<string>()
    const sections: CustomLetterSection[] = validRows.map(r => ({
      key: slugify(r.heading, used),
      heading: r.heading.trim().slice(0, 80),
      description: r.description.trim().slice(0, 500),
    }))
    // AI-refined prompt when available; otherwise a deterministic fallback so
    // creation never dead-ends if the refine call failed or was skipped.
    const fallbackPrompt = `Fill each section of this "${title.trim()}" letter from the doctor's dictation, in formal professional letter prose. Only include what is stated; leave a section empty if it is not covered.\n\n${sections.map(s => `- ${s.heading}: ${s.description || 'relevant content'}`).join('\n')}`
    onSave({
      id: initial?.id ?? 'ltr_' + Date.now(),
      title: title.trim().slice(0, 100),
      description: description.trim().slice(0, 500),
      sections,
      prompt: (prompt.trim() || fallbackPrompt).slice(0, 6000),
    })
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit letter template' : 'Create letter template'} maxWidth="md">
      <div className="px-5 pb-5 space-y-4">
        <p className="text-sm text-[var(--text2)]">
          Give your letter type a name and the topics it should cover. The AI cleans up the wording and builds it into a reusable template — only you can see and use it.
        </p>

        <Input label="Title" value={title} maxLength={100} placeholder="e.g. Insurance Support Letter"
          onChange={e => { setTitle(e.target.value); setRefined(false) }} />
        <Input label="Short description (optional)" value={description} maxLength={500} placeholder="What this letter is for"
          onChange={e => { setDescription(e.target.value); setRefined(false) }} />

        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--text)]">Topics</p>
          {rows.map((row, i) => (
            <div key={i} className="rounded-[var(--r)] border border-[var(--border)] p-2.5 space-y-2 bg-[var(--bg)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text3)] w-4 shrink-0">{i + 1}</span>
                <input
                  value={row.heading}
                  maxLength={80}
                  onChange={e => updateRow(i, { heading: e.target.value })}
                  placeholder="Topic heading (e.g. Diagnosis)"
                  className="flex-1 text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--blue)]"
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0} aria-label="Move up"
                    className="w-6 h-6 flex items-center justify-center text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"
                    className="w-6 h-6 flex items-center justify-center text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1} aria-label="Remove topic"
                    className="w-6 h-6 flex items-center justify-center text-[var(--text3)] hover:text-[var(--danger)] disabled:opacity-30">×</button>
                </div>
              </div>
              <input
                value={row.description}
                maxLength={500}
                onChange={e => updateRow(i, { description: e.target.value })}
                placeholder="What should this topic include? (optional)"
                className="w-full text-sm bg-white border border-[var(--border)] rounded-[var(--r-sm)] px-2.5 py-1.5 text-[var(--text2)] outline-none focus:border-[var(--blue)]"
              />
            </div>
          ))}
          {rows.length < MAX_SECTIONS && (
            <button type="button" onClick={addRow}
              className="text-xs font-medium text-[var(--blue)] hover:underline">+ Add topic</button>
          )}
        </div>

        {refined && prompt && (
          <div className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="text-xs font-semibold text-green-600 mb-1">AI-refined generation prompt</p>
            <p className="text-xs text-[var(--text2)] whitespace-pre-wrap max-h-32 overflow-y-auto">{prompt}</p>
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
          {!refined && (
            <Button variant="secondary" onClick={handleRefine} disabled={!canProceed || refining} className="flex-1">
              {refining ? 'Refining…' : 'Refine with AI'}
            </Button>
          )}
          <Button variant="primary" onClick={handleSave} disabled={!canProceed || refining} className="flex-[1.2]">
            {refined ? 'Save template' : 'Save as written'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
