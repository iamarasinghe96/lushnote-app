'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Workplace { name: string; type: string }
interface UserRow {
  uid: string; email: string; displayName: string; credentials: string; status: string; tier: string
  position?: string; workPhone?: string; workplaces: Workplace[]
  onboardingComplete: boolean; termsAccepted: boolean; marketingConsent: boolean
  geminiUsage: unknown; createdAt: number | null; updatedAt: number | null
}
interface UserDetail extends UserRow { noteCount: number; patientCount: number; authDisabled: boolean | null; lastSignIn: number | null }

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '—')
const dt = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—')

function StatusBadge({ status }: { status: string }) {
  const s = status === 'disabled'
    ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 ${s}`}>{status}</span>
}

export default function UsersPanel() {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<UserDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetchList() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function call(body: Record<string, unknown>) {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? 'Request failed') }
    return res.json()
  }

  async function fetchList() {
    setFetching(true); setError(null)
    try { const r = await call({ action: 'list' }); setUsers((r as { users: UserRow[] }).users) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setFetching(false) }
  }

  async function openUser(uid: string) {
    setLoadingDetail(true); setSelected(null)
    try { const r = await call({ action: 'detail', uid }); setSelected((r as { user: UserDetail }).user) }
    catch (e) { setToast(e instanceof Error ? e.message : 'Failed to load user') } finally { setLoadingDetail(false) }
  }

  async function doAction(action: string, uid: string, extra?: Record<string, unknown>) {
    setBusy(true)
    try {
      await call({ action, uid, ...extra })
      setToast('Done')
      await fetchList()
      if (action === 'remove') setSelected(null)
      else await openUser(uid)
    } catch (e) { setToast(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) }
  }

  function removeUser(u: UserDetail) {
    const typed = window.prompt(`This permanently deletes ${u.displayName || u.email} and ALL their data (${u.noteCount} notes, ${u.patientCount} patients), across Firestore, Storage and sign-in. This cannot be undone.\n\nType the user's email to confirm:`)
    if (typed == null) return
    doAction('remove', u.uid, { confirmEmail: typed.trim() })
  }

  async function exportCsv() {
    try {
      const r = await call({ action: 'export' }) as { users: { displayName: string; email: string; workplace: string }[] }
      const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
      const csv = ['Name,Email,Workplace', ...r.users.map(u => [u.displayName, u.email, u.workplace].map(esc).join(','))].join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'lushnote-marketing-contacts.csv'; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setToast(`Exported ${r.users.length} consented contact(s)`)
    } catch (e) { setToast(e instanceof Error ? e.message : 'Export failed') }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => `${u.displayName} ${u.email} ${u.workplaces.map(w => w.name).join(' ')}`.toLowerCase().includes(q))
  }, [users, search])

  const gemini = (() => {
    const g = selected?.geminiUsage as Record<string, { count?: number; tokens?: number; date?: string }> | null
    const f = g?.['gemini-2.5-flash']
    return f ? `${f.count ?? 0} req${f.tokens ? ` · ${f.tokens} tok` : ''}${f.date ? ` (${f.date})` : ''}` : '—'
  })()

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Detail view */}
      {selected ? (
        <div className="rounded-2xl p-5 space-y-4" style={CARD}>
          <button onClick={() => setSelected(null)} className="text-sm text-[#2563eb]">← Back to all users</button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-[#0f172a]">{selected.displayName || '(no name)'}</h2>
            <StatusBadge status={selected.status} />
            {selected.tier === 'admin' && <span className="text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 bg-blue-50 text-[#2563eb] border-blue-200">admin</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Email" value={selected.email} />
            <Field label="Credentials" value={selected.credentials || '—'} />
            <Field label="Workplace" value={selected.workplaces[0]?.name || '—'} />
            <Field label="Position" value={selected.position || '—'} />
            <Field label="Notes" value={selected.noteCount < 0 ? '—' : String(selected.noteCount)} />
            <Field label="Patients" value={selected.patientCount < 0 ? '—' : String(selected.patientCount)} />
            <Field label="Gemini usage" value={gemini} />
            <Field label="Marketing consent" value={selected.marketingConsent ? 'Yes' : 'No'} />
            <Field label="Signed up" value={day(selected.createdAt)} />
            <Field label="Last sign-in" value={dt(selected.lastSignIn)} />
          </div>
          <p className="text-[11px] text-[#94a3b8]">Clinical content is never shown here — counts only, to preserve patient confidentiality.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {selected.status === 'disabled'
              ? <button disabled={busy} onClick={() => doAction('reactivate', selected.uid)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50">Reactivate</button>
              : <button disabled={busy} onClick={() => doAction('suspend', selected.uid)} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm disabled:opacity-50">Suspend</button>}
            <button disabled={busy} onClick={() => { if (window.confirm('Delete this user’s stored files (signature, recordings)?')) doAction('clearStorage', selected.uid) }} className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569] disabled:opacity-50">Clear storage</button>
            <button disabled={busy} onClick={() => removeUser(selected)} className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm disabled:opacity-50 ml-auto">Remove user</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-2 items-center">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name / email / workplace…" className="flex-1 text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
            <button onClick={exportCsv} className="shrink-0 px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569]">Export CSV</button>
            <button onClick={fetchList} className="shrink-0 text-sm text-[#2563eb]">Refresh</button>
          </div>

          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={fetchList} className="ml-2 underline">Retry</button></div>}

          {fetching || loadingDetail ? (
            <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-[#94a3b8] text-sm py-6">No users match.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-[#94a3b8]">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</p>
              {filtered.map(u => (
                <button key={u.uid} onClick={() => openUser(u.uid)} className="w-full text-left rounded-xl p-3 flex items-center gap-3 hover:brightness-95" style={CARD}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#0f172a] truncate">{u.displayName || '(no name)'}</span>
                      <StatusBadge status={u.status} />
                    </div>
                    <div className="flex gap-2 mt-0.5 text-[11px] text-[#94a3b8] flex-wrap">
                      <span className="truncate">{u.email}</span>
                      {u.workplaces[0]?.name && <><span>·</span><span className="truncate">{u.workplaces[0].name}</span></>}
                      <span>·</span><span>{day(u.createdAt)}</span>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#94a3b8] shrink-0" aria-hidden><polyline points="9,18 15,12 9,6" /></svg>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-[#0f172a] text-white text-xs rounded-full px-4 py-2">{toast}</div>}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-[#94a3b8]">{label}</div>
      <div className="text-[#0f172a] break-words">{value}</div>
    </div>
  )
}
