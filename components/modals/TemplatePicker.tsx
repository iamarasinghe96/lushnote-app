'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/hooks/useAuth'
import type { AnyTemplate, Template } from '@/types'

interface TemplatePickerProps {
  open: boolean
  onSelect: (template: AnyTemplate) => void
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

export default function TemplatePicker({ open, onSelect, onCancel }: TemplatePickerProps) {
  const { profile } = useAuth()
  const [builtins, setBuiltins] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    if (!open || loaded.current) return
    loaded.current = true
    import('@/data/templates-prompts.json')
      .then(mod => setBuiltins((mod.default as Template[]) ?? []))
      .catch(() => setBuiltins([]))
  }, [open])

  const custom: AnyTemplate[] = profile?.customTemplates ?? []
  const all: AnyTemplate[] = [...(builtins as AnyTemplate[]), ...custom]

  const recentIds = getRecentIds()
  const favIds: (string | number)[] = profile?.favoriteTemplateIds ?? []

  const q = search.trim().toLowerCase()
  const filtered = q
    ? all.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    : all

  // Sort: favourites first, then recents, then rest
  const sorted = q
    ? filtered
    : [
        ...filtered.filter(t => favIds.includes(t.id)),
        ...filtered.filter(t => !favIds.includes(t.id) && recentIds.includes(t.id)),
        ...filtered.filter(t => !favIds.includes(t.id) && !recentIds.includes(t.id)),
      ]

  function handleSelect(t: AnyTemplate) {
    recordUsage(t.id)
    onSelect(t)
  }

  return (
    <Modal open={open} onClose={onCancel} title="Choose template" maxWidth="lg">
      <div className="px-5 pb-5 space-y-3">
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

        {sorted.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--text3)]">
            {all.length === 0 ? 'No templates loaded' : 'No templates match your search'}
          </div>
        ) : (
          <ul className="space-y-1 max-h-[55vh] overflow-y-auto -mx-1 px-1">
            {sorted.map(t => {
              const isFav = favIds.includes(t.id)
              const isRecent = recentIds.includes(t.id)
              return (
                <li key={String(t.id)}>
                  <button
                    onClick={() => handleSelect(t)}
                    className="w-full text-left rounded-[var(--r)] px-3 py-2.5
                               hover:bg-[var(--bg)] active:bg-[var(--blue-lt)]
                               transition-colors"
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
    </Modal>
  )
}
