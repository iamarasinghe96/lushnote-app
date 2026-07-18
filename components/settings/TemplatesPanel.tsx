'use client'

import { useState, useEffect, useMemo } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import CustomLetterBuilderModal from '@/components/modals/CustomLetterBuilderModal'
import type { User, Template, CustomTemplate, AnyTemplate, CustomLetterTemplate } from '@/types'

interface TemplatesPanelProps {
  profile: User
  onSave: (data: Partial<User>) => Promise<void>
  onToast: (msg: string) => void
}

const TPL_TYPE_LABELS: Record<string, string> = {
  session: 'Session', document: 'Document', both: 'Both',
}

const TEMPLATE_SECTIONS = [
  { id: 'diagnosis',     label: 'Diagnosis' },
  { id: 'presentation',  label: 'Presentation' },
  { id: 'history',       label: 'History' },
  { id: 'medications',   label: 'Medications' },
  { id: 'mse',           label: 'Mental State Examination' },
  { id: 'content',       label: 'Session Content' },
  { id: 'scales',        label: 'Rating Scales' },
  { id: 'risk',          label: 'Risk Assessment' },
  { id: 'referrals',     label: 'Referrals & Correspondence' },
  { id: 'summary',       label: 'Summary' },
  { id: 'nextsteps',     label: 'Next Steps' },
]

const ALL_SECTION_IDS = TEMPLATE_SECTIONS.map(s => s.id)

interface CustomTemplateForm {
  title: string
  category: string
  specialty: string
  tplType: 'session' | 'document' | 'both'
  description: string
  sections: string[]
  noteLength: 'brief' | 'balanced' | 'detailed'
  additionalInstructions: string
}

function defaultForm(): CustomTemplateForm {
  return {
    title: '',
    category: '',
    specialty: 'Psychiatry',
    tplType: 'session',
    description: '',
    sections: [...ALL_SECTION_IDS],
    noteLength: 'balanced',
    additionalInstructions: '',
  }
}

function assemblePrompt(form: CustomTemplateForm): string {
  const sectionList = TEMPLATE_SECTIONS
    .filter(s => form.sections.includes(s.id))
    .map(s => s.label)
    .join(', ')

  const lengthInstruction = {
    brief:    'Keep it concise - dot points only, most important information.',
    balanced: 'Use full sentences with appropriate clinical detail.',
    detailed: 'Be comprehensive - use direct quotes where relevant, expand on clinical reasoning.',
  }[form.noteLength]

  const typeLabel = form.tplType === 'session' ? 'session note'
    : form.tplType === 'document' ? 'clinical document'
    : 'clinical note'

  return [
    `Generate a ${typeLabel} for a ${form.specialty} clinician.`,
    `\nInclude the following sections: ${sectionList}.`,
    `\n${lengthInstruction}`,
    form.additionalInstructions ? `\nAdditional instructions: ${form.additionalInstructions}` : '',
  ].join('').trim()
}

export default function TemplatesPanel({ profile, onSave, onToast }: TemplatesPanelProps) {
  const [builtins, setBuiltins] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [favIds, setFavIds] = useState<(string | number)[]>(profile.favoriteTemplateIds ?? [])
  const [savingFav, setSavingFav] = useState<string | number | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState<CustomTemplateForm>(defaultForm())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [letterBuilderOpen, setLetterBuilderOpen] = useState(false)
  const [letterBuilderInitial, setLetterBuilderInitial] = useState<CustomLetterTemplate | null>(null)
  const [deletingLetterId, setDeletingLetterId] = useState<string | null>(null)

  const letterTemplates: CustomLetterTemplate[] = profile.customLetterTemplates ?? []

  async function saveLetterTemplates(next: CustomLetterTemplate[], toast: string) {
    try {
      await onSave({ customLetterTemplates: next })
      onToast(toast)
    } catch {
      onToast('Failed to save letter template')
    }
  }
  async function handleSaveLetterTemplate(t: CustomLetterTemplate) {
    setLetterBuilderOpen(false)
    setLetterBuilderInitial(null)
    const next = letterTemplates.some(x => x.id === t.id)
      ? letterTemplates.map(x => x.id === t.id ? t : x)
      : [...letterTemplates, t]
    await saveLetterTemplates(next, 'Letter template saved')
  }
  function moveLetter(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= letterTemplates.length) return
    const next = [...letterTemplates];[next[i], next[j]] = [next[j], next[i]]
    saveLetterTemplates(next, 'Order updated')
  }
  async function deleteLetter(id: string) {
    setDeletingLetterId(null)
    await saveLetterTemplates(letterTemplates.filter(t => t.id !== id), 'Letter template deleted')
  }

  useEffect(() => {
    import('@/data/clinical-templates.json')
      .then(mod => setBuiltins(mod.default as Template[]))
      .catch(() => setBuiltins([]))
  }, [])

  const custom: CustomTemplate[] = profile.customTemplates ?? []

  type ListItem = { kind: 'builtin'; tpl: Template } | { kind: 'custom'; tpl: CustomTemplate }

  const allItems: ListItem[] = [
    ...builtins.map(t => ({ kind: 'builtin' as const, tpl: t })),
    ...custom.map(t => ({ kind: 'custom' as const, tpl: t })),
  ]

  const q = search.trim().toLowerCase()
  const filtered = q
    ? allItems.filter(item => {
        const { tpl } = item
        return (
          tpl.title.toLowerCase().includes(q) ||
          tpl.category.toLowerCase().includes(q) ||
          tpl.description.toLowerCase().includes(q)
        )
      })
    : allItems

  const sorted = q
    ? filtered
    : [
        ...filtered.filter(i => favIds.includes(i.tpl.id)),
        ...filtered.filter(i => !favIds.includes(i.tpl.id)),
      ]

  const assembledPromptPreview = useMemo(() => assemblePrompt(form), [form])

  async function toggleFav(id: string | number) {
    const next = favIds.includes(id) ? favIds.filter(x => x !== id) : [...favIds, id]
    setSavingFav(id)
    try {
      await onSave({ favoriteTemplateIds: next })
      setFavIds(next)
    } catch {
      onToast('Failed to update favourites')
    } finally {
      setSavingFav(null)
    }
  }

  async function deleteCustom(id: string) {
    setDeletingId(id)
    try {
      const next = custom.filter(t => t.id !== id)
      await onSave({ customTemplates: next })
      onToast('Custom template deleted')
    } catch {
      onToast('Failed to delete template')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSaveCustomTemplate() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    if (!form.description.trim()) { setError('Description is required.'); return }
    if (form.sections.length === 0) { setError('Select at least one section.'); return }

    setSaving(true)
    setError(null)
    try {
      const newTemplate: CustomTemplate = {
        id: 'custom_' + Date.now(),
        title: form.title.trim(),
        category: form.category.trim() || 'Custom',
        description: form.description.trim(),
        prompt: assemblePrompt(form),
        custom: true,
      }
      await onSave({ customTemplates: [...(profile.customTemplates || []), newTemplate] })
      setForm(defaultForm())
      setShowAddForm(false)
      onToast('Custom template saved.')
    } catch {
      onToast('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  function toggleSection(id: string, checked: boolean) {
    setForm(f => ({
      ...f,
      sections: checked
        ? [...f.sections, id]
        : f.sections.filter(x => x !== id),
    }))
  }

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--text2)]">
          {builtins.length} built-in · {custom.length} custom
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { setShowAddForm(s => !s); setError(null) }}
        >
          {showAddForm ? 'Cancel' : '+ Custom template'}
        </Button>
      </div>

      {/* Custom template form */}
      {showAddForm && (
        <div className="border border-[var(--border)] rounded-[var(--r-lg)] p-4 mt-2"
             style={{ boxShadow: 'var(--shadow-sm)' }}>
          <h3 className="text-sm font-semibold text-[var(--text)] mb-4">Create Custom Template</h3>

          {/* Title */}
          <Input
            label="Template name"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="e.g. CBT Session Note"
          />

          {/* Category */}
          <div className="mt-3">
            <label className="block text-xs font-medium text-[var(--text2)] mb-1">Category</label>
            <input
              list="category-suggestions"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Progress Notes"
              className="mt-0.5 w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2
                         bg-white text-[var(--text)] placeholder:text-[var(--text3)]
                         outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
            <datalist id="category-suggestions">
              <option value="Progress Notes" />
              <option value="Assessments" />
              <option value="Therapy Notes" />
              <option value="Risk & Safety" />
              <option value="Letters & Reports" />
            </datalist>
          </div>

          {/* Specialty */}
          <div className="mt-3">
            <label className="block text-xs font-medium text-[var(--text2)] mb-1">Specialty</label>
            <select
              value={form.specialty}
              onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
              className="mt-0.5 w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2
                         bg-white text-[var(--text)]
                         outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            >
              <option value="Psychiatry">Psychiatry</option>
              <option value="Psychology">Psychology</option>
              <option value="General Practice">General Practice</option>
              <option value="Paediatrics">Paediatrics</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Note type */}
          <div className="mt-3">
            <label className="block text-xs font-medium text-[var(--text2)] mb-1">Note type</label>
            <select
              value={form.tplType}
              onChange={e => setForm(f => ({ ...f, tplType: e.target.value as CustomTemplateForm['tplType'] }))}
              className="mt-0.5 w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2
                         bg-white text-[var(--text)]
                         outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            >
              <option value="session">Session note</option>
              <option value="document">Document / letter</option>
              <option value="both">Both</option>
            </select>
          </div>

          {/* Description */}
          <div className="mt-3">
            <Input
              label="Short description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="One sentence describing this template"
            />
          </div>

          {/* Sections */}
          <div className="mt-4">
            <label className="block text-xs font-medium text-[var(--text2)] mb-2">Sections to include</label>
            <div className="grid grid-cols-2 gap-1.5">
              {TEMPLATE_SECTIONS.map(s => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-[var(--text)] cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={form.sections.includes(s.id)}
                    onChange={e => toggleSection(s.id, e.target.checked)}
                    className="accent-[var(--blue)]"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </div>

          {/* Note length */}
          <div className="mt-4">
            <label className="block text-xs font-medium text-[var(--text2)] mb-2">Note length</label>
            <div className="flex gap-2">
              {(['brief', 'balanced', 'detailed'] as const).map(l => (
                <label
                  key={l}
                  className={`flex-1 border rounded-[var(--r)] p-2 text-center text-xs cursor-pointer select-none transition-colors
                    ${form.noteLength === l
                      ? 'border-[var(--blue)] bg-[var(--blue-lt)] text-[var(--blue)] font-medium'
                      : 'border-[var(--border)] text-[var(--text2)] hover:bg-[var(--bg)]'}`}
                >
                  <input
                    type="radio"
                    name="noteLength"
                    value={l}
                    checked={form.noteLength === l}
                    onChange={() => setForm(f => ({ ...f, noteLength: l }))}
                    className="sr-only"
                  />
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {/* Additional instructions */}
          <div className="mt-3">
            <Textarea
              label="Additional instructions (optional)"
              rows={3}
              value={form.additionalInstructions}
              onChange={e => setForm(f => ({ ...f, additionalInstructions: e.target.value }))}
              placeholder="Any specific requirements for this template..."
            />
          </div>

          {/* Assembled prompt preview */}
          <div className="mt-4">
            <label className="block text-xs font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">
              Assembled AI Prompt (read-only)
            </label>
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r)] p-3
                            text-xs text-[var(--text2)] whitespace-pre-wrap font-mono leading-relaxed
                            max-h-40 overflow-y-auto">
              {assembledPromptPreview}
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-xs text-[var(--danger)] mt-2">{error}</p>}

          {/* Save */}
          <Button
            variant="primary"
            onClick={handleSaveCustomTemplate}
            loading={saving}
            className="mt-4 w-full"
            size="sm"
          >
            Save Template
          </Button>
        </div>
      )}

      {/* ── My Letter Templates (custom letter types) — kept near the top so
             they're manageable without scrolling past the 116 built-ins ─────── */}
      <div className="rounded-[var(--r-lg)] border border-[var(--border)] p-4" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-[var(--text)]">My Letter Templates</h3>
          <button
            onClick={() => { setLetterBuilderInitial(null); setLetterBuilderOpen(true) }}
            className="text-xs font-medium text-[var(--blue)] hover:underline"
          >
            + New
          </button>
        </div>
        <p className="text-xs text-[var(--text3)] mb-3">
          Your own letter types for dictation and Create Document. Use ▲▼ to set their priority in the pickers.
        </p>
        {letterTemplates.length === 0 ? (
          <p className="text-xs text-[var(--text3)] italic">No letter templates yet. Tap &ldquo;+ New&rdquo; to create one.</p>
        ) : (
          <ul className="space-y-2">
            {letterTemplates.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 rounded-[var(--r)] border border-[var(--border)] px-3 py-2">
                <div className="flex flex-col shrink-0">
                  <button onClick={() => moveLetter(i, -1)} disabled={i === 0} aria-label="Move up"
                    className="text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-30 leading-none text-xs">▲</button>
                  <button onClick={() => moveLetter(i, 1)} disabled={i === letterTemplates.length - 1} aria-label="Move down"
                    className="text-[var(--text3)] hover:text-[var(--text)] disabled:opacity-30 leading-none text-xs">▼</button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text)] truncate">{t.title}</p>
                  <p className="text-xs text-[var(--text3)] truncate">{t.description || `${t.sections.length} topic${t.sections.length !== 1 ? 's' : ''}`}</p>
                </div>
                <button onClick={() => { setLetterBuilderInitial(t); setLetterBuilderOpen(true) }} aria-label="Edit"
                  className="shrink-0 text-[var(--text3)] hover:text-[var(--blue)] p-1">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                {deletingLetterId === t.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => deleteLetter(t.id)} className="text-xs text-[var(--danger)] font-medium">Delete</button>
                    <button onClick={() => setDeletingLetterId(null)} className="text-xs text-[var(--text3)]">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDeletingLetterId(t.id)} aria-label="Delete" className="shrink-0 text-[var(--text3)] hover:text-[var(--danger)] p-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search templates…"
        className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                   px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                   outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                   transition-colors"
      />

      {/* Template list */}
      {sorted.length === 0 ? (
        <p className="text-sm text-[var(--text3)] py-4 text-center">
          {q ? 'No templates match your search.' : 'No templates loaded.'}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {sorted.map(item => {
            const { tpl } = item
            const id = tpl.id
            const isFav = favIds.includes(id)
            const isCustom = item.kind === 'custom'
            const tplType = 'tplType' in tpl ? (tpl as AnyTemplate & { tplType?: string }).tplType : undefined

            return (
              <li key={String(id)}>
                <div className="flex items-center gap-2 px-2 py-2 rounded-[var(--r)] hover:bg-[var(--bg)] group">
                  <button
                    onClick={() => toggleFav(id)}
                    disabled={savingFav === id}
                    className="shrink-0 text-[var(--text3)] hover:text-amber-400 transition-colors disabled:opacity-40"
                    aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24"
                         fill={isFav ? '#f59e0b' : 'none'}
                         stroke={isFav ? '#f59e0b' : 'currentColor'}
                         strokeWidth="2" aria-hidden>
                      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                    </svg>
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text)] truncate">{tpl.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <p className="text-xs text-[var(--text3)] truncate">{tpl.category}</p>
                      {tplType && (
                        <>
                          <span className="text-xs text-[var(--text3)]">·</span>
                          <span className="text-xs text-[var(--text3)]">{TPL_TYPE_LABELS[tplType] ?? tplType}</span>
                        </>
                      )}
                      {tpl.description && (
                        <p className="text-xs text-[var(--text2)] truncate w-full">{tpl.description}</p>
                      )}
                    </div>
                  </div>
                  {isCustom && (
                    <>
                      <span className="text-[10px] bg-[#ede9fe] text-[#5b21b6] rounded-full px-2 py-0.5 font-medium shrink-0">
                        Custom
                      </span>
                      <button
                        onClick={() => deleteCustom((item.tpl as CustomTemplate).id)}
                        disabled={deletingId === (item.tpl as CustomTemplate).id}
                        className="w-6 h-6 rounded flex items-center justify-center shrink-0
                                   text-[var(--text3)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100
                                   transition-all disabled:opacity-40"
                        aria-label="Delete custom template"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <polyline points="3,6 5,6 21,6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CustomLetterBuilderModal
        open={letterBuilderOpen}
        initial={letterBuilderInitial}
        onSave={handleSaveLetterTemplate}
        onClose={() => { setLetterBuilderOpen(false); setLetterBuilderInitial(null) }}
      />
    </div>
  )
}
