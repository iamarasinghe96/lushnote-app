'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Announcement { id: string; title: string; summary: string; details: string; version: string; published: boolean; createdAt: number | null; publishedAt: number | null }

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—')

export default function AnnouncementsPanel() {
  const { user } = useAuth()
  const [items, setItems] = useState<Announcement[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [published, setPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { fetchAll() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function call(body: Record<string, unknown>) {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? 'Request failed') }
    return res.json()
  }

  async function fetchAll() {
    setFetching(true); setError(null)
    try { setItems((await call({ action: 'list' })).announcements) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setFetching(false) }
  }

  function resetForm() { setEditingId(null); setTitle(''); setVersion(''); setSummary(''); setDetails(''); setPublished(false) }
  function edit(a: Announcement) {
    setEditingId(a.id); setTitle(a.title); setVersion(a.version); setSummary(a.summary); setDetails(a.details); setPublished(a.published)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save() {
    if (!title.trim() || !summary.trim()) { setToast('Title and summary are required'); return }
    setSaving(true)
    try { await call({ action: 'save', id: editingId ?? undefined, title, version, summary, details, published }); setToast('Saved'); resetForm(); fetchAll() }
    catch (e) { setToast(e instanceof Error ? e.message : 'Save failed') } finally { setSaving(false) }
  }

  async function remove(id: string, t: string) {
    if (!window.confirm(`Delete "${t}"? This cannot be undone.`)) return
    setDeletingId(id)
    try { await call({ action: 'delete', id }); setItems(prev => prev.filter(a => a.id !== id)); setToast('Deleted') }
    catch (e) { setToast(e instanceof Error ? e.message : 'Delete failed') } finally { setDeletingId(null) }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={fetchAll} className="ml-2 underline">Retry</button></div>}

      {/* Editor */}
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <h2 className="text-sm font-semibold text-[#0f172a]">{editingId ? 'Edit announcement' : 'New announcement'}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr,140px] gap-3">
          <div><label className="text-xs font-medium text-[#475569]">Title</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Faster note generation" className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" /></div>
          <div><label className="text-xs font-medium text-[#475569]">Version (optional)</label><input value={version} onChange={e => setVersion(e.target.value)} placeholder="v1.4" className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" /></div>
        </div>
        <div><label className="text-xs font-medium text-[#475569]">Summary (shown in the popup — keep it short)</label><textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" /></div>
        <div><label className="text-xs font-medium text-[#475569]">Details (What&apos;s New tab — one point per line, start a line with &quot;- &quot; for a bullet)</label><textarea value={details} onChange={e => setDetails(e.target.value)} rows={7} className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" /></div>
        <label className="flex items-center gap-2 text-sm text-[#475569]">
          <input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} className="h-4 w-4 rounded accent-[#2563eb]" />
          Published (visible to doctors — the newest published one triggers the one-time popup)
        </label>
        <div className="flex gap-2">
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#2563eb] text-white text-sm font-semibold disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform">{saving ? 'Saving…' : (editingId ? 'Update' : 'Create')}</button>
          {editingId && <button onClick={resetForm} className="px-4 rounded-xl border border-[var(--border)] text-sm text-[#475569]">Cancel</button>}
        </div>
      </div>

      {/* List */}
      {fetching ? (
        <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
      ) : items.length === 0 ? (
        <p className="text-center text-[#94a3b8] text-sm py-6">No announcements yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map(a => (
            <div key={a.id} className="rounded-xl p-3" style={CARD}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-[#0f172a]">{a.title}</span>
                {a.version && <span className="text-[11px] text-[#94a3b8]">{a.version}</span>}
                <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 ${a.published ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[#f1f5f9] text-[#94a3b8] border-[var(--border)]'}`}>{a.published ? 'published' : 'draft'}</span>
                <span className="text-[11px] text-[#94a3b8] ml-auto">{day(a.publishedAt ?? a.createdAt)}</span>
              </div>
              <p className="text-xs text-[#475569] mt-1">{a.summary}</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => edit(a)} className="text-xs text-[#2563eb]">Edit</button>
                <button onClick={() => remove(a.id, a.title)} disabled={deletingId === a.id} className="text-xs text-red-600 disabled:opacity-50">{deletingId === a.id ? 'Deleting…' : 'Delete'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-[#0f172a] text-white text-xs rounded-full px-4 py-2">{toast}</div>}
    </div>
  )
}
