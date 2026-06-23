'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/hooks/useAuth'
import { updateProfile } from '@/lib/firestore/profiles'
import type { AnyTemplate, NoteLength, Template, LetterType } from '@/types'

interface TemplatePickerProps {
  open: boolean
  onSelect: (template: AnyTemplate, noteLength: NoteLength) => void
  onCancel: () => void
  /** When provided, a "Letters" tab is shown so the user can switch into letter mode. */
  onSelectLetter?: (letterType: LetterType) => void
}

const USAGE_KEY = 'lnTemplateUsage'
const MAX_RECENT = 5
// Comprehensive Psychology Note — the app's default template. Surfaced under
// "Recently Used" for first-time users and used by "Skip, use default note".
const DEFAULT_TEMPLATE_ID = 1

function getRecentIds(): (string | number)[] {
  try {
    const stored = localStorage.getItem(USAGE_KEY)
    if (stored === null) return [DEFAULT_TEMPLATE_ID]
    const parsed = JSON.parse(stored) as (string | number)[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_TEMPLATE_ID]
  } catch {
    return [DEFAULT_TEMPLATE_ID]
  }
}

function recordUsage(id: string | number) {
  const ids = getRecentIds().filter(x => x !== id)
  localStorage.setItem(USAGE_KEY, JSON.stringify([id, ...ids].slice(0, MAX_RECENT)))
}

type Tab = 'all' | 'session' | 'document' | 'custom' | 'letters'

const NOTE_LENGTHS: { value: NoteLength; label: string }[] = [
  { value: 'brief', label: 'Brief' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'detailed', label: 'Detailed' },
]

// Preferred display order for category sections; anything else falls to the end alphabetically.
const CATEGORY_ORDER = ['Progress Notes', 'Assessments', 'Therapy Notes', 'Risk & Safety']
function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat)
  return i === -1 ? CATEGORY_ORDER.length : i
}

const LETTER_OPTIONS: { type: LetterType; title: string; description: string; icon: JSX.Element }[] = [
  {
    type: 'referral',
    title: 'Referral Letter',
    description: 'Refer this patient to a specialist, unit, or service',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    ),
  },
  {
    type: 'records',
    title: 'Request Medical Records',
    description: 'Request clinical notes, investigations, or discharge summaries',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    type: 'freetext',
    title: 'Free Text Letter',
    description: 'Write or dictate a custom letter with your own content',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
]

function templateType(t: AnyTemplate): 'session' | 'document' | 'both' {
  return 'tplType' in t ? t.tplType : 'session'
}

function matchesTab(t: AnyTemplate, tab: Tab, customIds: Set<string>): boolean {
  if (tab === 'all') return true
  if (tab === 'custom') return customIds.has(String(t.id))
  const type = templateType(t)
  if (tab === 'session') return type === 'session' || type === 'both'
  if (tab === 'document') return type === 'document' || type === 'both'
  return true
}

export default function TemplatePicker({ open, onSelect, onCancel, onSelectLetter }: TemplatePickerProps) {
  const { profile, user, refreshProfile } = useAuth()
  const [builtins, setBuiltins] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [noteLength, setNoteLength] = useState<NoteLength>(
    (profile?.personalisation?.noteLength as NoteLength) ?? 'balanced'
  )
  const [favIds, setFavIds] = useState<(string | number)[]>(profile?.favoriteTemplateIds ?? [])
  const [savingFav, setSavingFav] = useState<string | number | null>(null)
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

  // Keep local favourites in sync with the profile (including after a toggle refresh)
  useEffect(() => {
    setFavIds(profile?.favoriteTemplateIds ?? [])
  }, [profile?.favoriteTemplateIds])

  const custom: AnyTemplate[] = profile?.customTemplates ?? []
  const customIds = new Set(custom.map(t => String(t.id)))
  // Dedupe by id so a stale duplicate can never render twice
  const all: AnyTemplate[] = Array.from(
    new Map([...(builtins as AnyTemplate[]), ...custom].map(t => [String(t.id), t])).values()
  )

  const recentIds = getRecentIds()

  const tabFiltered = all.filter(t => matchesTab(t, tab, customIds))

  const q = search.trim().toLowerCase()
  const searchFiltered = q
    ? tabFiltered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q)
      )
    : tabFiltered

  // Highlight groups (only when not searching) — favourites + recently used, shown as chips.
  const byId = new Map(tabFiltered.map(t => [String(t.id), t]))
  const favTemplates = favIds.map(id => byId.get(String(id))).filter(Boolean) as AnyTemplate[]
  const recentTemplates = recentIds
    .filter(id => !favIds.includes(id))
    .map(id => byId.get(String(id)))
    .filter(Boolean) as AnyTemplate[]

  // Category groups (only when not searching), in preferred order.
  const categoryGroups: { label: string; items: AnyTemplate[] }[] = []
  if (!q) {
    const map = new Map<string, AnyTemplate[]>()
    for (const t of tabFiltered) {
      const cat = t.category || 'Other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(t)
    }
    const cats = Array.from(map.keys()).sort((a, b) => {
      const r = categoryRank(a) - categoryRank(b)
      return r !== 0 ? r : a.localeCompare(b)
    })
    for (const cat of cats) {
      categoryGroups.push({ label: cat, items: map.get(cat)!.sort((a, b) => a.title.localeCompare(b.title)) })
    }
  }

  const sessionCount = all.filter(t => { const x = templateType(t); return x === 'session' || x === 'both' }).length
  const documentCount = all.filter(t => { const x = templateType(t); return x === 'document' || x === 'both' }).length

  const showLetters = Boolean(onSelectLetter)
  const isLettersTab = tab === 'letters'

  function handleSelect(t: AnyTemplate) {
    recordUsage(t.id)
    onSelect(t, noteLength)
  }

  async function toggleFav(id: string | number) {
    if (!user) return
    const prev = favIds
    const next = favIds.includes(id) ? favIds.filter(x => x !== id) : [...favIds, id]
    setFavIds(next)
    setSavingFav(id)
    try {
      await updateProfile(user.uid, { favoriteTemplateIds: next })
      await refreshProfile()
    } catch {
      setFavIds(prev)
    } finally {
      setSavingFav(null)
    }
  }

  function handleSkip() {
    // "Default note" is the Comprehensive Psychology Note. Use the real template
    // once built-ins have loaded; fall back to a generic note if not yet ready.
    const defaultTemplate = all.find(t => String(t.id) === String(DEFAULT_TEMPLATE_ID))
    if (defaultTemplate) {
      handleSelect(defaultTemplate)
      return
    }
    const fallback: AnyTemplate = {
      id: 0,
      title: 'Default Progress Note',
      category: 'Progress Notes',
      tplType: 'session',
      description: 'Standard clinical progress note',
      prompt: 'Generate a comprehensive clinical progress note based on the transcript.',
    } as AnyTemplate
    recordUsage(0)
    onSelect(fallback, noteLength)
  }

  function renderCard(t: AnyTemplate, showCategory = false) {
    const isFav = favIds.includes(t.id)
    const isRecent = recentIds.includes(t.id)
    return (
      <li key={String(t.id)}>
        <div className="flex items-stretch gap-1 rounded-[var(--r)] hover:bg-[var(--bg)] motion-safe:transition-colors">
          <button
            onClick={() => handleSelect(t)}
            className="flex-1 min-w-0 text-left rounded-[var(--r)] px-3 py-2.5
                       active:bg-[var(--blue-lt)] motion-safe:transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {showCategory && t.category && (
                  <p className="text-[10px] font-semibold text-[var(--blue)] uppercase tracking-wide mb-0.5">{t.category}</p>
                )}
                <p className="text-sm font-medium text-[var(--text)] truncate">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-[var(--text2)] mt-0.5 line-clamp-1">{t.description}</p>
                )}
              </div>
              <div className="flex gap-1 shrink-0 mt-0.5">
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
          <button
            onClick={() => toggleFav(t.id)}
            disabled={savingFav === t.id}
            aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
            className="shrink-0 w-10 flex items-center justify-center rounded-[var(--r)]
                       text-[var(--text3)] hover:text-amber-400 motion-safe:transition-colors disabled:opacity-40"
          >
            <svg width="17" height="17" viewBox="0 0 24 24"
                 fill={isFav ? '#f59e0b' : 'none'}
                 stroke={isFav ? '#f59e0b' : 'currentColor'}
                 strokeWidth="2" aria-hidden>
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
            </svg>
          </button>
        </div>
      </li>
    )
  }

  function renderChipGroup(label: string, items: AnyTemplate[]) {
    if (items.length === 0) return null
    return (
      <div className="mb-1">
        <div className="sticky top-0 z-10 -mx-5 px-5 py-1.5 flex items-center gap-2
                        bg-[var(--bg)] border-y border-[var(--border)]">
          <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-widest">{label}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2 pb-1">
          {items.map(t => (
            <button
              key={String(t.id)}
              onClick={() => handleSelect(t)}
              className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-white text-xs text-[var(--text2)]
                         hover:border-[var(--blue)] hover:text-[var(--blue)] motion-safe:transition-colors truncate max-w-full"
            >
              {t.title}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Modal open={open} onClose={onCancel} title="Select Clinical Template" maxWidth="lg">
      <div className="flex flex-col" style={{ maxHeight: '80vh' }}>

        {/* Tabs */}
        <div className="flex gap-0 px-5 pt-1 border-b border-[var(--border)] overflow-x-auto scrollbar-none shrink-0">
          {([
            { key: 'all' as Tab, label: 'All', count: all.length },
            { key: 'session' as Tab, label: 'Session', count: sessionCount },
            { key: 'document' as Tab, label: 'Document', count: documentCount },
            ...(custom.length > 0
              ? [{ key: 'custom' as Tab, label: 'My Templates', count: custom.length }]
              : []),
            ...(showLetters
              ? [{ key: 'letters' as Tab, label: 'Letters', count: LETTER_OPTIONS.length }]
              : []),
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
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                tab === key
                  ? 'bg-[var(--blue)] text-white'
                  : 'bg-[var(--border)] text-[var(--text3)]'
              }`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {isLettersTab ? (
          /* Letters tab — choose a letter type for this patient */
          <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0 space-y-3">
            <p className="text-sm text-[var(--text2)]">
              Switch to a letter for this patient. Their name carries over automatically.
            </p>
            {LETTER_OPTIONS.map(opt => (
              <button
                key={opt.type}
                onClick={() => onSelectLetter?.(opt.type)}
                className="w-full flex items-center gap-4 p-4 rounded-[var(--r-lg)] border border-[var(--border)]
                  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                  motion-safe:active:scale-[0.98] motion-safe:transition-all motion-safe:duration-150"
              >
                <span className="text-[var(--blue)] shrink-0">{opt.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">{opt.title}</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">{opt.description}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" className="text-[var(--text3)] shrink-0" aria-hidden>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="px-5 pt-3 pb-2 shrink-0">
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
              {tabFiltered.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--text3)]">
                  {all.length === 0 ? 'No templates loaded' : 'No templates here yet'}
                </div>
              ) : q ? (
                searchFiltered.length === 0 ? (
                  <div className="py-10 text-center text-sm text-[var(--text3)]">No templates match your search</div>
                ) : (
                  <ul className="space-y-1 pb-2">{searchFiltered.map(t => renderCard(t, true))}</ul>
                )
              ) : (
                <div className="pb-2">
                  {renderChipGroup('Favourites', favTemplates)}
                  {renderChipGroup('Recently Used', recentTemplates)}
                  {categoryGroups.map((g, i) => (
                    <div key={g.label} className={i === 0 && favTemplates.length === 0 && recentTemplates.length === 0 ? '' : 'mt-2'}>
                      {/* Sticky section header — full bleed, high-contrast */}
                      <div className="sticky top-0 z-10 -mx-5 px-5 py-1.5 flex items-center gap-2
                                      bg-[var(--bg)] border-y border-[var(--border)]">
                        <span className="text-[11px] font-bold text-[var(--text)] uppercase tracking-widest">
                          {g.label}
                        </span>
                        <span className="text-[11px] text-[var(--text3)] font-normal">{g.items.length}</span>
                      </div>
                      <ul className="space-y-0.5 pt-0.5">{g.items.map(t => renderCard(t, false))}</ul>
                    </div>
                  ))}
                </div>
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
          </>
        )}

        {/* Footer buttons */}
        <div className="flex gap-2 px-5 pb-4 pt-2">
          <button
            onClick={onCancel}
            className="flex-shrink-0 px-4 py-2 text-sm text-[var(--text2)] border border-[var(--border)] rounded-[var(--r)] hover:bg-[var(--bg)] motion-safe:transition-colors"
          >
            ← Back
          </button>
          {!isLettersTab && (
            <button
              onClick={handleSkip}
              className="flex-1 py-2 text-sm font-medium text-[var(--blue)] bg-[var(--blue-lt)]
                         border border-[var(--blue)] rounded-[var(--r)]
                         hover:bg-[var(--blue)] hover:text-white motion-safe:transition-colors"
            >
              Skip, use default note
            </button>
          )}
        </div>

      </div>
    </Modal>
  )
}
