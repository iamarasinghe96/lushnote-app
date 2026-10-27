'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import Select from '@/components/ui/Select'
import {
  BUCKETS, bucketOf, groupByBucket, progress, sortItems,
  type Person, type RoadmapItem, type RoadmapStatus,
} from '@/lib/roadmap'

// The admin console's landing page: the to-do list the admins share
// (lib/roadmap.ts), grouped into buckets. Take an item or a step before
// starting it, so the other person can see it is being done.
//
// Hundreds of ideas arrive from the research backlog, so a bucket shows its
// work in progress in full and keeps ideas and finished items folded away
// until asked for.

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

const STATUS_LABEL: Record<RoadmapStatus, string> = { idea: 'Idea', todo: 'To do', doing: 'Doing', done: 'Done' }
const STATUS_TONE: Record<RoadmapStatus, string> = {
  idea: 'bg-amber-50 text-amber-800 border-amber-200',
  todo: 'bg-slate-100 text-slate-600 border-slate-200',
  doing: 'bg-blue-50 text-[#1d4ed8] border-blue-200',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

type Filter = 'all' | 'mine' | 'open'

const initials = (p: Person) => (p.name || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')

function Who({ p }: { p: Person }) {
  return (
    <span title={p.name} className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#5ad6a7] text-white text-[10px] font-semibold shrink-0">
      {initials(p)}
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden
      className={`shrink-0 text-slate-400 motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export default function RoadmapPanel() {
  const { user } = useAuth()
  const [items, setItems] = useState<RoadmapItem[] | null>(null)
  const [me, setMe] = useState<Person | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Buckets the person has opened or closed by hand; the rest follow the
  // default (open while something in them is in progress).
  const [bucketOpen, setBucketOpen] = useState<Record<string, boolean>>({})
  const [shelfOpen, setShelfOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newBucket, setNewBucket] = useState<string>(BUCKETS[0])
  const [newStep, setNewStep] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<{ id: string; title: string; notes: string; theme: string } | null>(null)

  const call = useCallback(async (body: Record<string, unknown>) => {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/roadmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error || 'Request failed')
    return json as Record<string, unknown>
  }, [user])

  const load = useCallback(async () => {
    try {
      const r = await call({ action: 'list' }) as { items: RoadmapItem[]; me: Person }
      setItems(r.items)
      setMe(r.me)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the roadmap')
    }
  }, [call])

  useEffect(() => { if (user) void load() }, [user, load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  // Two people work on this list. Coming back to the tab is when the other
  // person's changes matter, so that is when it refreshes, not on a timer.
  useEffect(() => {
    function onVisible() { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  async function act(body: Record<string, unknown>, done?: string) {
    setBusy(true)
    try {
      const r = await call(body)
      if (typeof r.added === 'number') setToast(r.added ? `Added ${r.added} suggested items` : 'Nothing new to add')
      else if (done) setToast(done)
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'That did not work')
    } finally {
      await load()
      setBusy(false)
    }
  }

  const toggleIn = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n }

  // A tick shows at once and the server confirms behind it; waiting a round
  // trip for a checkbox to change made it feel broken. The reload in act()
  // puts it back if the server refused.
  function toggleStep(itemId: string, stepId: string) {
    setItems(prev => prev && prev.map(i => i.id !== itemId ? i : {
      ...i, steps: i.steps.map(st => st.id === stepId ? { ...st, done: !st.done } : st),
    }))
    void act({ action: 'step', id: itemId, step: { op: 'toggle', stepId } })
  }

  async function addItem() {
    const title = newTitle.trim()
    if (!title) return
    setNewTitle('')
    setBucketOpen(prev => ({ ...prev, [newBucket]: true }))
    await act({ action: 'create', title, theme: newBucket }, 'Added')
  }

  async function addStep(id: string) {
    const text = (newStep[id] ?? '').trim()
    if (!text) return
    setNewStep(prev => ({ ...prev, [id]: '' }))
    await act({ action: 'step', id, step: { op: 'add', text } })
  }

  async function saveEdit() {
    if (!editing) return
    const { id, title, notes, theme } = editing
    setEditing(null)
    await act({ action: 'update', id, title, notes, theme }, 'Saved')
  }

  if (error && !items) {
    return <div className="max-w-4xl mx-auto px-4 py-6"><div className="rounded-xl px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200">{error}</div></div>
  }
  if (!items) {
    return <div className="max-w-4xl mx-auto px-4 py-6 text-sm text-slate-500">Loading the roadmap…</div>
  }

  const q = search.trim().toLowerCase()
  const visible = sortItems(items).filter(i => {
    if (q && !`${i.title} ${i.notes} ${i.backlogId ?? ''}`.toLowerCase().includes(q)) return false
    if (filter === 'mine') return i.owner?.uid === me?.uid || i.steps.some(s => s.owner?.uid === me?.uid && !s.done)
    if (filter === 'open') return !i.owner && i.status !== 'done' && i.status !== 'idea'
    return true
  })
  const groups = groupByBucket(visible)
  const totals = { active: items.filter(i => i.status === 'todo' || i.status === 'doing').length, ideas: items.filter(i => i.status === 'idea').length }

  function renderCard(item: RoadmapItem) {
    const p = progress(item.steps)
    const isOpen = open.has(item.id)
    const mine = item.owner?.uid === me?.uid
    const isEditing = editing?.id === item.id
    return (
      <div key={item.id} className="rounded-2xl p-4 space-y-3" style={CARD}>
        <div className="flex items-start gap-3">
          <button onClick={() => setOpen(prev => toggleIn(prev, item.id))} className="flex-1 min-w-0 text-left" aria-expanded={isOpen}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
              {item.backlogId && <span className="text-[10px] font-mono text-slate-400">{item.backlogId}</span>}
            </div>
            <p className={`mt-1 font-semibold ${item.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{item.title}</p>
            {p.total > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#10b981]" style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} />
                </div>
                <span className="text-[11px] text-slate-500 shrink-0">{p.done}/{p.total} steps</span>
              </div>
            )}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {item.owner ? (
              <>
                <Who p={item.owner} />
                {mine && <button onClick={() => void act({ action: 'release', id: item.id })} disabled={busy} className="text-xs text-slate-500 underline disabled:opacity-50">Release</button>}
              </>
            ) : item.status !== 'done' && (
              <button onClick={() => void act({ action: 'take', id: item.id }, item.status === 'idea' ? 'Yours, and moved to To do' : 'It is yours')} disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50">
                Take it
              </button>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="space-y-3 pt-1 border-t border-slate-100">
            {isEditing ? (
              <div className="space-y-2 pt-3">
                <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Title"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                <Select value={bucketOf(editing.theme) === 'Other' ? BUCKETS[0] : editing.theme} onChange={v => setEditing({ ...editing, theme: v })}
                  options={BUCKETS} aria-label="Bucket" />
                <textarea value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} placeholder="Notes" rows={5}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <button onClick={() => void saveEdit()} disabled={busy || !editing.title.trim()} className="px-3 py-1.5 rounded-lg bg-[#2563eb] text-white text-xs font-medium disabled:opacity-50">Save</button>
                  <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700">Cancel</button>
                </div>
              </div>
            ) : item.notes ? (
              <p className="pt-3 text-sm text-slate-600 whitespace-pre-line">{item.notes}</p>
            ) : null}

            <ul className="space-y-1">
              {item.steps.map(s => {
                const stepMine = s.owner?.uid === me?.uid
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={s.done} disabled={busy} onChange={() => toggleStep(item.id, s.id)}
                      className="w-4 h-4 accent-[#10b981] shrink-0" aria-label={s.text} />
                    <span className={`flex-1 min-w-0 text-sm ${s.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{s.text}</span>
                    {s.owner ? (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <Who p={s.owner} />
                        {stepMine && !s.done && (
                          <button onClick={() => void act({ action: 'step', id: item.id, step: { op: 'release', stepId: s.id } })} disabled={busy} className="text-[11px] text-slate-500 underline">Release</button>
                        )}
                      </span>
                    ) : !s.done && (
                      <button onClick={() => void act({ action: 'step', id: item.id, step: { op: 'take', stepId: s.id } })} disabled={busy}
                        className="text-[11px] px-2 py-0.5 rounded-md border border-slate-200 text-slate-600 shrink-0">Take</button>
                    )}
                    <button onClick={() => { if (window.confirm('Remove this step?')) void act({ action: 'step', id: item.id, step: { op: 'remove', stepId: s.id } }) }}
                      disabled={busy} aria-label="Remove step" className="text-slate-300 hover:text-red-600 text-sm px-1 shrink-0">×</button>
                  </li>
                )
              })}
            </ul>

            <div className="flex gap-2">
              <input value={newStep[item.id] ?? ''} onChange={e => setNewStep(prev => ({ ...prev, [item.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') void addStep(item.id) }}
                placeholder="Add a step" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
              <button onClick={() => void addStep(item.id)} disabled={busy || !(newStep[item.id] ?? '').trim()}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 disabled:opacity-50">Add</button>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {(['idea', 'todo', 'doing', 'done'] as RoadmapStatus[]).map(st => (
                <button key={st} onClick={() => void act({ action: 'update', id: item.id, status: st })} disabled={busy || item.status === st}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${item.status === st ? STATUS_TONE[st] : 'border-slate-300 text-slate-700'} disabled:cursor-default`}>
                  {STATUS_LABEL[st]}
                </button>
              ))}
              {!isEditing && (
                <button onClick={() => setEditing({ id: item.id, title: item.title, notes: item.notes, theme: item.theme })} className="text-xs text-slate-600 underline ml-1">Edit</button>
              )}
              <span className="flex-1" />
              {item.updatedBy && <span className="text-[11px] text-slate-400">Last change: {item.updatedBy}{item.updatedAt ? `, ${new Date(item.updatedAt).toLocaleDateString()}` : ''}</span>}
              <button onClick={() => { if (window.confirm(`Delete "${item.title}" and its steps?`)) void act({ action: 'delete', id: item.id }, 'Deleted') }}
                disabled={busy} className="text-xs text-red-600 underline">Delete</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Ideas and finished items: one line each, a click opens the full card.
  function renderShelf(bucket: string, kind: 'idea' | 'done', list: RoadmapItem[]) {
    if (!list.length) return null
    const key = `${bucket}:${kind}`
    const isOpen = shelfOpen.has(key) || !!q
    return (
      <div className="rounded-2xl overflow-hidden" style={CARD}>
        <button onClick={() => setShelfOpen(prev => toggleIn(prev, key))} aria-expanded={isOpen}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700">
          <Chevron open={isOpen} />
          <span className="font-medium">{kind === 'idea' ? 'Ideas' : 'Done'}</span>
          <span className="text-xs text-slate-400">{list.length}</span>
        </button>
        {isOpen && (
          <ul className="border-t border-slate-100 divide-y divide-slate-100">
            {list.map(item => open.has(item.id) ? (
              <li key={item.id} className="p-2">{renderCard(item)}</li>
            ) : (
              <li key={item.id} className="flex items-center gap-2 px-4 py-2">
                <button onClick={() => setOpen(prev => toggleIn(prev, item.id))} className={`flex-1 min-w-0 text-left text-sm truncate ${kind === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {item.backlogId && <span className="font-mono text-[10px] text-slate-400 mr-2">{item.backlogId}</span>}
                  {item.title}
                </button>
                {kind === 'idea' && !item.owner && (
                  <button onClick={() => void act({ action: 'take', id: item.id }, 'Yours, and moved to To do')} disabled={busy}
                    className="text-[11px] px-2 py-0.5 rounded-md border border-slate-200 text-slate-600 shrink-0 disabled:opacity-50">Take it</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Roadmap</h1>
          <p className="text-xs text-slate-500">
            {totals.active} in progress or to do · {totals.ideas} ideas. Take an item or a step before you start it.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['all', 'mine', 'open'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full border ${filter === f ? 'bg-[#2563eb] text-white border-[#2563eb]' : 'border-slate-300 text-slate-700'}`}>
              {f === 'all' ? 'All' : f === 'mine' ? 'Mine' : 'Not taken'}
            </button>
          ))}
          <button onClick={() => void load()} disabled={busy} className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-700 disabled:opacity-50">Refresh</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl p-5 space-y-3 text-sm text-slate-700" style={CARD}>
          <p>The roadmap is empty. Start with the suggested list: the current priorities as to-dos, and every open idea from the research backlog (docs/ROADMAP.md), sorted into buckets.</p>
          <button onClick={() => void act({ action: 'addSuggested' })} disabled={busy}
            className="px-4 py-2 rounded-lg bg-[#2563eb] text-white text-sm font-medium disabled:opacity-50">
            Add the suggested roadmap
          </button>
        </div>
      ) : (
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the roadmap (title, notes or backlog ID)"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      )}

      {items.length > 0 && groups.length === 0 && (
        <div className="rounded-2xl p-4 text-sm text-slate-500" style={CARD}>
          {q ? 'Nothing matches that search.' : filter === 'mine' ? 'Nothing taken by you yet.' : 'Everything in progress has been taken.'}
        </div>
      )}

      {groups.map(({ bucket, items: list }) => {
        const active = list.filter(i => i.status === 'todo' || i.status === 'doing')
        const ideas = list.filter(i => i.status === 'idea')
        const done = list.filter(i => i.status === 'done')
        const isOpen = bucketOpen[bucket] ?? (active.length > 0 || !!q)
        return (
          <section key={bucket} className="space-y-2">
            <button onClick={() => setBucketOpen(prev => ({ ...prev, [bucket]: !isOpen }))} aria-expanded={isOpen}
              className="w-full flex items-center gap-2 text-left">
              <Chevron open={isOpen} />
              <h2 className="text-sm font-semibold text-slate-800">{bucket}</h2>
              <span className="text-xs text-slate-400">
                {[active.length && `${active.length} active`, ideas.length && `${ideas.length} ideas`, done.length && `${done.length} done`].filter(Boolean).join(' · ')}
              </span>
            </button>
            {isOpen && (
              <div className="space-y-2 pl-1">
                {active.map(renderCard)}
                {renderShelf(bucket, 'idea', ideas)}
                {renderShelf(bucket, 'done', done)}
              </div>
            )}
          </section>
        )
      })}

      {items.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex gap-2 flex-wrap">
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addItem() }}
              placeholder="Add an item to the roadmap" className="flex-1 min-w-[12rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            <div className="w-56 max-w-full"><Select value={newBucket} onChange={setNewBucket} options={BUCKETS} aria-label="Bucket for the new item" /></div>
            <button onClick={() => void addItem()} disabled={busy || !newTitle.trim()} className="px-4 py-2 rounded-lg bg-[#2563eb] text-white text-sm font-medium disabled:opacity-50">Add</button>
          </div>
          <button onClick={() => void act({ action: 'addSuggested' })} disabled={busy} className="text-xs text-slate-500 underline disabled:opacity-50">
            Add any new suggested items (from docs/ROADMAP.md)
          </button>
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-[#0f172a] text-white text-xs rounded-full px-4 py-2">{toast}</div>}
    </div>
  )
}
