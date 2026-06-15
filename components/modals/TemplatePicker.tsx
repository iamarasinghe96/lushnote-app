'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/hooks/useAuth'
import type { AnyTemplate, NoteLength, Template } from '@/types'

interface TemplatePickerProps {
  open: boolean
  onSelect: (template: AnyTemplate, noteLength: NoteLength) => void
  onCancel: () => void
}

const USAGE_KEY = 'lnTemplateUsage'
const MAX_RECENT = 5

function getRecentIds(): (string | number)[] {
  try {
    return JSON.parse(localStorage.getItem(USAGE_KEY) ?? '[]') as (string | number)[]
  } catch {
    return []
  }
}

function recordUsage(id: string | number) {
  const ids = getRecentIds().filter(x => x !== id)
  localStorage.setItem(USAGE_KEY, JSON.stringify([id, ...ids].slice(0, MAX_RECENT)))
}

type Tab = 'all' | 'session' | 'document'

const NOTE_LENGTHS: { value: NoteLength; label: string }[] = [
  { value: 'brief', label: 'Brief' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'detailed', label: 'Detailed' },
]

export default function TemplatePicker({ open, onSelect, onCancel }: TemplatePickerProps) {
  const { profile } = useAuth()
  const [builtins, setBuiltins] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [noteLength, setNoteLength] = useState<NoteLength>(
    (profile?.personalisation?.noteLength as NoteLength) ?? 'balanced'
  )
  const loaded = useRef(false)

  useEffect(() => {
    if (!open || loaded.current) return
    loaded.current = true
    import('@/data/clinical-templates.json')
      .then(mod => setBuiltins(mod.default as Template[]))
      .catch(() => setBuiltins([]))
  }, [open])

  // Sync note length with profile preference when modal opens
  useEffect(() => {
    if (open) {
      setNoteLength((profile?.personalisation?.noteLength as NoteLength) ?? 'balanced')
      setSearch('')
      setTab('all')
    }
  }, [open, profile?.personalisation?.noteLength])

  const custom: AnyTemplate[] = profile?.customTemplates ?? []
  const all: AnyTemplate[] = [...(builtins as AnyTemplate[]), ...custom]

  // Tab filtering
  const tabFiltered = tab === 'all'
    ? all
    : all.filter(t => ('tplType' in t ? t.tplType === tab : tab === 'session'))

  const recentIds = getRecentIds()
  const favIds: (string | number)[] = profile?.favoriteTemplateIds ?? []

  const q = search.trim().toLowerCase()
  const filtered = q
    ? tabFiltered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    : tabFiltered

  const sorted = q
    ? filtered
    : [
        ...filtered.filter(t => favIds.includes(t.id)),
        ...filtered.filter(t => !favIds.includes(t.id) && recentIds.includes(t.id)),
        ...filtered.filter(t => !favIds.includes(t.id) && !recentIds.includes(t.id)),
      ]

  const sessionCount = all.filter(t => ('tplType' in t ? t.tplType === 'session' : true)).length
  const documentCount = all.filter(t => ('tplType' in t ? t.tplType === 'document' : false)).length

  function handleSelect(t: AnyTemplate) {
    recordUsage(t.id)
    onSelect(t, noteLength)
  }

  function handleSkip() {
    const defaultTemplate: AnyTemplate = {
      id: 0,
      title: 'Default Progress Note',
      category: 'Progress Notes',
      tplType: 'session',
      description: 'Standard clinical progress note',
      prompt: 'Generate a comprehensive clinical progress note based on the transcript.',
    } as AnyTemplate
    recordUsage(0)
    onSelect(defaultTemplate, noteLength)
  }

  return (
    <Modal open={open} onClose={onCancel} title="Select Clinical Template" maxWidth="lg">
      <div className="flex flex-col" style={{ maxHeight: '80vh' }}>

        {/* Tabs */}
        <div className="flex gap-0 px-5 pt-1 border-b border-[var(--border)]">
          {([
            { key: 'all' as Tab, label: 'All Templates', count: all.length },
            { key: 'session' as Tab, label: 'Session Templates', count: sessionCount },
            { key: 'document' as Tab, label: 'Document Templates', count: documentCount },
          ]).map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === key
                  ? 'border-[var(--blue)] text-[var(--blue)]'
                  : 'border-transparent text-[var(--text3)] hover:text-[var(--text2)]'
              }`}
            >
              {label}
              {all.length > 0 && (
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                  tab === key
                    ? 'bg-[var(--blue)] text-white'
                    : 'bg-[var(--border)] text-[var(--text3)]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                       px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors"
            autoFocus
          />
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto px-5 min-h-0">
          {sorted.length === 0 ? (
            <div className="py-10 text-center text-sm text-[var(--text3)]">
              {all.length === 0 ? 'No templates loaded' : 'No templates match your search'}
            </div>
          ) : (
            <ul className="space-y-1 pb-2">
              {sorted.map(t => {
                const isFav = favIds.includes(t.id)
                const isRecent = recentIds.includes(t.id)
                return (
                  <li key={String(t.id)}>
                    <button
                      onClick={() => handleSelect(t)}
                      className="w-full text-left rounded-[var(--r)] px-3 py-2.5
                                 hover:bg-[var(--bg)] active:bg-[var(--blue-lt)]
                                 motion-safe:transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text)] truncate">{t.title}</p>
                          <p className="text-xs text-[var(--text3)] truncate">{t.category}</p>
                          {t.description && (
                            <p className="text-xs text-[var(--text2)] mt-0.5 line-clamp-1">{t.description}</p>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0 mt-0.5">
                          {isFav && (
                            <span className="text-[10px] bg-[var(--blue-lt)] text-[var(--blue)] rounded-full px-1.5 py-0.5 font-medium">
                              Fav
                            </span>
                          )}
                          {isRecent && !isFav && (
                            <span className="text-[10px] bg-[var(--bg)] text-[var(--text3)] rounded-full px-1.5 py-0.5 border border-[var(--border)]">
                              Recent
                            </span>
                          )}
                          {'custom' in t && t.custom && (
                            <span className="text-[10px] bg-[#ede9fe] text-[#5b21b6] rounded-full px-1.5 py-0.5 font-medium">
                              Custom
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Note length selector */}
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text3)] uppercase tracking-wide">Note Length</span>
            <span className="text-xs font-semibold text-[var(--blue)] capitalize">{noteLength}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {NOTE_LENGTHS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setNoteLength(value)}
                className={`py-1.5 rounded-[var(--r-sm)] text-xs font-medium motion-safe:transition-colors ${
                  noteLength === value
                    ? 'bg-[var(--blue)] text-white'
                    : 'bg-white border border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Footer buttons */}
        <div className="flex gap-2 px-5 pb-4 pt-2">
          <button
            onClick={onCancel}
            className="flex-shrink-0 px-4 py-2 text-sm text-[var(--text2)] border border-[var(--border)] rounded-[var(--r)] hover:bg-[var(--bg)] motion-safe:transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={handleSkip}
            className="flex-1 py-2 text-sm text-[var(--text2)] border border-[var(--border)] rounded-[var(--r)] hover:bg-[var(--bg)] motion-safe:transition-colors"
          >
            Skip, use default note
          </button>
        </div>

      </div>
    </Modal>
  )
}
