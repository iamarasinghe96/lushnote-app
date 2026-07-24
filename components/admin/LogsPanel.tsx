'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface LogRow { id: string; level: 'error' | 'warn' | 'info'; tag: string; message: string; route: string; status: number | null; uid: string | null; createdAt: number | null }
interface AuditRow { id: string; actorUid: string; action: string; targetUid: string | null; meta: Record<string, unknown> | null; createdAt: number | null }

const LEVEL_STYLE: Record<string, string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-blue-50 text-[#2563eb] border-blue-200',
}

function when(ms: number | null): string {
  if (!ms) return '—'
  try { return new Date(ms).toLocaleString() } catch { return '—' }
}

export default function LogsPanel() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'logs' | 'audit'>('logs')
  const [logs, setLogs] = useState<LogRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [search, setSearch] = useState('')

  async function call(body: Record<string, unknown>) {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/logs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? 'Request failed') }
    return res.json()
  }

  async function fetchTab(which: 'logs' | 'audit') {
    setFetching(true); setError(null)
    try {
      if (which === 'logs') { const r = await call({ action: 'listLogs', limit: 300 }); setLogs((r as { logs: LogRow[] }).logs) }
      else { const r = await call({ action: 'listAudit', limit: 300 }); setAudit((r as { audit: AuditRow[] }).audit) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setFetching(false) }
  }

  useEffect(() => { fetchTab(tab) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab])

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter(l =>
      (levelFilter === 'all' || l.level === levelFilter) &&
      (!q || `${l.tag} ${l.message} ${l.route} ${l.uid ?? ''}`.toLowerCase().includes(q))
    )
  }, [logs, levelFilter, search])

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase()
    return audit.filter(a => !q || `${a.action} ${a.actorUid} ${a.targetUid ?? ''} ${JSON.stringify(a.meta ?? '')}`.toLowerCase().includes(q))
  }, [audit, search])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Tabs + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl p-1" style={CARD}>
          {(['logs', 'audit'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-[#2563eb] text-white' : 'text-[#475569] hover:bg-black/5'}`}>
              {t === 'logs' ? 'Logs & Errors' : 'Audit'}
            </button>
          ))}
        </div>
        <button onClick={() => fetchTab(tab)} className="text-sm text-[#2563eb]">Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {tab === 'logs' && (
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value as typeof levelFilter)} className="text-sm border border-[var(--border)] rounded-lg px-2 py-2 bg-white outline-none focus:border-[#2563eb]">
            <option value="all">All levels</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings</option>
            <option value="info">Info</option>
          </select>
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tab === 'logs' ? 'Search message / route / uid…' : 'Search action / uid…'} className="flex-1 min-w-[180px] text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={() => fetchTab(tab)} className="ml-2 underline">Retry</button></div>}

      {fetching ? (
        <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
      ) : tab === 'logs' ? (
        filteredLogs.length === 0 ? <p className="text-center text-[#94a3b8] text-sm py-6">No logs match.</p> : (
          <div className="space-y-2">
            {filteredLogs.map(l => (
              <div key={l.id} className="rounded-xl p-3 text-sm" style={CARD}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 ${LEVEL_STYLE[l.level] ?? LEVEL_STYLE.info}`}>{l.level}</span>
                  <span className="text-xs font-mono text-[#2563eb]">{l.tag}</span>
                  {l.status != null && <span className="text-xs text-[#94a3b8]">{l.status}</span>}
                  <span className="text-xs text-[#94a3b8] ml-auto">{when(l.createdAt)}</span>
                </div>
                <p className="text-[#0f172a] mt-1 break-words whitespace-pre-wrap">{l.message}</p>
                <div className="flex gap-3 mt-1 text-[11px] text-[#94a3b8]">
                  <span>{l.route}</span>
                  {l.uid && <span className="font-mono">uid: {l.uid}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        filteredAudit.length === 0 ? <p className="text-center text-[#94a3b8] text-sm py-6">No audit entries.</p> : (
          <div className="space-y-2">
            {filteredAudit.map(a => (
              <div key={a.id} className="rounded-xl p-3 text-sm" style={CARD}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[#0f172a]">{a.action}</span>
                  <span className="text-xs text-[#94a3b8] ml-auto">{when(a.createdAt)}</span>
                </div>
                <div className="flex gap-3 mt-1 text-[11px] text-[#94a3b8] flex-wrap">
                  <span className="font-mono">by: {a.actorUid}</span>
                  {a.targetUid && <span className="font-mono">target: {a.targetUid}</span>}
                  {a.meta && <span className="font-mono break-all">{JSON.stringify(a.meta)}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
