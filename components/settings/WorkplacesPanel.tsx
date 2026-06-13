'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { detectIdPattern, applyWorkspaceTheme } from '@/lib/utils'
import { WP_THEMES } from '@/types'
import type { User, Workplace, WorkplaceType } from '@/types'

interface WorkplacesPanelProps {
  profile: User
  onSave: (workplaces: Workplace[], activeId: string) => Promise<void>
  onToast: (msg: string) => void
}

const WORKPLACE_TYPES: WorkplaceType[] = [
  'Private Practice',
  'Hospital',
  'Community Mental Health',
  'Telehealth',
  'Other',
]

const REG_SYSTEMS = [
  { value: 'none', label: 'None' },
  { value: 'existing', label: 'Existing system' },
]

interface EditForm {
  name: string
  type: WorkplaceType
  regSystem: 'none' | 'existing'
  regFormat: string
  themeIndex: number
}

function emptyForm(): EditForm {
  return { name: '', type: 'Private Practice', regSystem: 'none', regFormat: '', themeIndex: 0 }
}

function wpToForm(wp: Workplace): EditForm {
  return {
    name: wp.name,
    type: wp.type,
    regSystem: wp.regSystem,
    regFormat: wp.regFormat ?? '',
    themeIndex: wp.themeIndex,
  }
}

export default function WorkplacesPanel({ profile, onSave, onToast }: WorkplacesPanelProps) {
  const workplaces = profile.workplaces ?? []
  const activeId = profile.activeWorkplaceId ?? workplaces[0]?.id ?? ''

  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [form, setForm] = useState<EditForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const isFree = profile.tier === 'free'
  const canAdd = !isFree || workplaces.length < 1

  function startEdit(wp: Workplace) {
    setAddingNew(false)
    setEditingId(wp.id)
    setForm(wpToForm(wp))
  }

  function startAdd() {
    setEditingId(null)
    setAddingNew(true)
    setForm(emptyForm())
  }

  function cancelEdit() {
    setEditingId(null)
    setAddingNew(false)
  }

  async function saveEdit() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const pattern = form.regSystem === 'existing' && form.regFormat
        ? detectIdPattern(form.regFormat)
        : null
      const updated: Workplace[] = workplaces.map(wp =>
        wp.id === editingId
          ? {
              ...wp,
              name: form.name.trim(),
              type: form.type,
              regSystem: form.regSystem,
              regFormat: form.regSystem === 'existing' ? form.regFormat : undefined,
              regPattern: pattern?.regex,
              regTemplate: pattern?.template,
              themeIndex: form.themeIndex,
            }
          : wp
      )
      await onSave(updated, activeId)
      setEditingId(null)
      onToast('Workplace saved')
    } catch {
      onToast('Failed to save workplace')
    } finally {
      setSaving(false)
    }
  }

  async function saveNew() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const pattern = form.regSystem === 'existing' && form.regFormat
        ? detectIdPattern(form.regFormat)
        : null
      const newWp: Workplace = {
        id: `wp_${Date.now()}`,
        name: form.name.trim(),
        type: form.type,
        regSystem: form.regSystem,
        regFormat: form.regSystem === 'existing' ? form.regFormat : undefined,
        regPattern: pattern?.regex,
        regTemplate: pattern?.template,
        themeIndex: form.themeIndex,
      }
      const updated = [...workplaces, newWp]
      await onSave(updated, activeId)
      setAddingNew(false)
      onToast('Workplace added')
    } catch {
      onToast('Failed to add workplace')
    } finally {
      setSaving(false)
    }
  }

  async function handleSetActive(id: string) {
    const workplace = workplaces.find(w => w.id === id)
    if (!workplace) return
    applyWorkspaceTheme(workplace.themeIndex ?? 0)
    setSaving(true)
    try {
      await onSave(workplaces, id)
      onToast(`Switched to ${workplace.name}`)
    } catch {
      onToast('Failed to update active workplace')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (workplaces.length <= 1) return
    setDeletingId(id)
    try {
      const updated = workplaces.filter(w => w.id !== id)
      const newActive = id === activeId ? (updated[0]?.id ?? '') : activeId
      await onSave(updated, newActive)
      onToast('Workplace deleted')
    } catch {
      onToast('Failed to delete workplace')
    } finally {
      setDeletingId(null)
    }
  }

  const patternPreview = form.regSystem === 'existing' && form.regFormat
    ? detectIdPattern(form.regFormat)
    : null

  function InlineForm({ onSave: onFormSave }: { onSave: () => void }) {
    return (
      <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
        <Input
          label="Workplace name"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="e.g. City Psychiatry"
        />

        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">Type</label>
          <select
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value as WorkplaceType }))}
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2.5 text-sm text-[var(--text)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors"
          >
            {WORKPLACE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-1">Registration system</label>
          <select
            value={form.regSystem}
            onChange={e => setForm(f => ({ ...f, regSystem: e.target.value as 'none' | 'existing', regFormat: '' }))}
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2.5 text-sm text-[var(--text)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors"
          >
            {REG_SYSTEMS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {form.regSystem === 'existing' && (
          <div>
            <Input
              label="Example patient ID"
              value={form.regFormat}
              onChange={e => setForm(f => ({ ...f, regFormat: e.target.value }))}
              placeholder="e.g. 12345678AB"
            />
            {patternPreview && (
              <p className="mt-1 text-xs text-[var(--text3)]">
                Pattern: <span className="font-mono text-[var(--blue)]">{patternPreview.template}</span>
                {' '}— {patternPreview.description}
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--text)] mb-2">Colour theme</label>
          <div className="flex gap-2">
            {WP_THEMES.map((theme, i) => (
              <button
                key={i}
                onClick={() => setForm(f => ({ ...f, themeIndex: i }))}
                className={`w-8 h-8 rounded-full transition-transform
                  ${form.themeIndex === i ? 'scale-110 ring-2 ring-offset-2 ring-[var(--border)]' : ''}`}
                style={{ backgroundColor: theme.primary }}
                aria-label={`Theme ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={cancelEdit} disabled={saving} className="flex-1" size="sm">
            Cancel
          </Button>
          <Button variant="primary" onClick={onFormSave} loading={saving} className="flex-1" size="sm">
            Save
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      {workplaces.map(wp => {
        const isActive = wp.id === activeId
        const isEditing = editingId === wp.id
        const theme = WP_THEMES[wp.themeIndex] ?? WP_THEMES[0]

        return (
          <div
            key={wp.id}
            className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: theme.primary }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)] truncate">{wp.name}</p>
                  <p className="text-xs text-[var(--text3)]">{wp.type}</p>
                </div>
                {isActive && (
                  <span className="ml-1 text-[10px] bg-[var(--blue-lt)] text-[var(--blue)] rounded-full px-2 py-0.5 font-semibold shrink-0">
                    Active
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!isActive && (
                  <button
                    onClick={() => handleSetActive(wp.id)}
                    className="text-xs text-[var(--blue)] hover:underline px-1"
                  >
                    Set active
                  </button>
                )}
                <button
                  onClick={() => isEditing ? cancelEdit() : startEdit(wp)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center
                             text-[var(--text3)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition-colors"
                  aria-label="Edit"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                {workplaces.length > 1 && (
                  <button
                    onClick={() => handleDelete(wp.id)}
                    disabled={deletingId === wp.id}
                    className="w-7 h-7 rounded-lg flex items-center justify-center
                               text-[var(--text3)] hover:text-[var(--danger)] hover:bg-red-50
                               transition-colors disabled:opacity-40"
                    aria-label="Delete"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <polyline points="3,6 5,6 21,6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {isEditing && <InlineForm onSave={saveEdit} />}
          </div>
        )
      })}

      {addingNew && (
        <div
          className="rounded-[var(--r-lg)] border border-[var(--blue)]/30 bg-white p-4"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <p className="text-sm font-semibold text-[var(--text)] mb-1">New workplace</p>
          <InlineForm onSave={saveNew} />
        </div>
      )}

      {!addingNew && (
        canAdd ? (
          <Button variant="secondary" onClick={startAdd} size="sm">
            + Add workplace
          </Button>
        ) : (
          <p className="text-xs text-[var(--text3)]">
            Free plan includes 1 workplace.
          </p>
        )
      )}
    </div>
  )
}
