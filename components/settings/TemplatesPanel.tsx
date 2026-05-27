'use client'

import { useState, useEffect } from 'react'
import Button from '@/components/ui/Button'
import type { User, Template, CustomTemplate, AnyTemplate } from '@/types'

interface TemplatesPanelProps {
  profile: User
  onSave: (data: Partial<User>) => Promise<void>
  onToast: (msg: string) => void
}

const TPL_TYPE_LABELS: Record<string, string> = {
  session: 'Session', document: 'Document', both: 'Both',
}

export default function TemplatesPanel({ profile, onSave, onToast }: TemplatesPanelProps) {
  const [builtins, setBuiltins] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [favIds, setFavIds] = useState<(string | number)[]>(profile.favoriteTemplateIds ?? [])
  const [savingFav, setSavingFav] = useState<string | number | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [formTitle, setFormTitle] = useState('')
  const [formCategory, setFormCategory] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [addingSaving, setAddingSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

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

  async function handleAddTemplate() {
    const errors: Record<string, string> = {}
    if (!formTitle.trim()) errors.title = 'Title is required'
    if (!formCategory.trim()) errors.category = 'Category is required'
    if (!formDescription.trim()) errors.description = 'Description is required'
    if (!formPrompt.trim()) errors.prompt = 'Prompt instructions are required'
    if (Object.keys(errors).length) { setFormErrors(errors); return }

    setAddingSaving(true)
    try {
      const newTpl: CustomTemplate = {
        id: `custom_${Date.now()}`,
        title: formTitle.trim(),
        category: formCategory.trim(),
        description: formDescription.trim(),
        prompt: formPrompt.trim(),
        custom: true,
      }
      await onSave({ customTemplates: [...custom, newTpl] })
      setFormTitle(''); setFormCategory(''); setFormDescription(''); setFormPrompt('')
      setFormErrors({})
      setShowAddForm(false)
      onToast('Custom template added')
    } catch {
      onToast('Failed to add template')
    } finally {
      setAddingSaving(false)
    }
  }

  const CATEGORY_SUGGESTIONS = [
    'Progress Notes', 'Assessments', 'Therapy Notes', 'Risk & Safety',
    'Assessment', 'Follow-up', 'Discharge', 'Consultation', 'Group Therapy',
    'Medication Review', 'Crisis', 'Documentation',
  ]

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--text2)]">
          {builtins.length} built-in · {custom.length} custom
        </p>
        <Button variant="secondary" size="sm" onClick={() => setShowAddForm(s => !s)}>
          {showAddForm ? 'Cancel' : '+ Custom template'}
        </Button>
      </div>

      {/* Add custom template form */}
      {showAddForm && (
        <div className="rounded-[var(--r-lg)] border border-[var(--blue)]/30 bg-white p-4 space-y-3"
             style={{ boxShadow: 'var(--shadow-sm)' }}>
          <p className="text-sm font-semibold text-[var(--text)]">New custom template</p>

          {[
            { key: 'title', label: 'Title *', val: formTitle, set: setFormTitle, placeholder: 'e.g. PTSD Assessment' },
            { key: 'description', label: 'Short description *', val: formDescription, set: setFormDescription, placeholder: 'e.g. Structured PTSD assessment with trauma history' },
          ].map(({ key, label, val, set, placeholder }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">{label}</label>
              <input
                value={val}
                onChange={e => { set(e.target.value); setFormErrors(er => ({ ...er, [key]: '' })) }}
                placeholder={placeholder}
                className={`w-full rounded-[var(--r)] border bg-white px-3 py-2.5 text-sm text-[var(--text)]
                            placeholder:text-[var(--text3)] outline-none transition-colors
                            focus:ring-2 focus:ring-blue-500/10
                            ${formErrors[key] ? 'border-[var(--danger)] focus:border-[var(--danger)]' : 'border-[var(--border)] focus:border-[var(--blue)]'}`}
              />
              {formErrors[key] && <p className="mt-1 text-xs text-[var(--danger)]">{formErrors[key]}</p>}
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">Category *</label>
            <input
              value={formCategory}
              onChange={e => { setFormCategory(e.target.value); setFormErrors(er => ({ ...er, category: '' })) }}
              placeholder="e.g. Therapy Notes"
              list="category-suggestions"
              className={`w-full rounded-[var(--r)] border bg-white px-3 py-2.5 text-sm text-[var(--text)]
                          placeholder:text-[var(--text3)] outline-none transition-colors
                          focus:ring-2 focus:ring-blue-500/10
                          ${formErrors.category ? 'border-[var(--danger)] focus:border-[var(--danger)]' : 'border-[var(--border)] focus:border-[var(--blue)]'}`}
            />
            <datalist id="category-suggestions">
              {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
            </datalist>
            {formErrors.category && <p className="mt-1 text-xs text-[var(--danger)]">{formErrors.category}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">AI prompt instructions *</label>
            <textarea
              value={formPrompt}
              onChange={e => { setFormPrompt(e.target.value); setFormErrors(er => ({ ...er, prompt: '' })) }}
              rows={6}
              placeholder="Describe exactly what the AI should write for this note type…"
              className={`w-full rounded-[var(--r)] border bg-white px-3 py-2.5 text-sm text-[var(--text)]
                          placeholder:text-[var(--text3)] outline-none transition-colors resize-none
                          focus:ring-2 focus:ring-blue-500/10
                          ${formErrors.prompt ? 'border-[var(--danger)] focus:border-[var(--danger)]' : 'border-[var(--border)] focus:border-[var(--blue)]'}`}
            />
            {formErrors.prompt && <p className="mt-1 text-xs text-[var(--danger)]">{formErrors.prompt}</p>}
          </div>

          <Button variant="primary" onClick={handleAddTemplate} loading={addingSaving} size="sm">
            Add template
          </Button>
        </div>
      )}

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
    </div>
  )
}
