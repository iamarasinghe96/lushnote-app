'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Feedback { id: string; email: string; reasons: string[]; message: string; deletedAt: number | null }
interface Ticket { id: string; uid: string; name: string; email: string; ticket: string | null; topic: string | null; status: string; createdAt: number | null; updatedAt: number | null }

const dt = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '—')

const TICKET_STATUS_STYLE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-[#f1f5f9] text-[#94a3b8] border-[var(--border)]',
}

export default function FeedbackPanel() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'feedback' | 'tickets'>('feedback')
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved' | 'closed'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function call(body: Record<string, unknown>) {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/overview', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? 'Request failed') }
    return res.json()
  }

  async function setTicketStatus(id: string, status: string) {
    setBusyId(id)
    try {
      await call({ action: 'setTicketStatus', id, status })
      setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t))
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed') } finally { setBusyId(null) }
  }

  async function fetchTab(which: 'feedback' | 'tickets') {
    setFetching(true); setError(null)
    try {
      if (which === 'feedback') setFeedback((await call({ action: 'deletionFeedback' })).items)
      else setTickets((await call({ action: 'tickets' })).items)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setFetching(false) }
  }

  useEffect(() => { fetchTab(tab) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-xl p-1" style={CARD}>
          {(['feedback', 'tickets'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${tab === t ? 'bg-[#2563eb] text-white' : 'text-[#475569] hover:bg-black/5'}`}>
              {t === 'feedback' ? 'Deletion feedback' : 'Support tickets'}
            </button>
          ))}
        </div>
        <button onClick={() => fetchTab(tab)} className="text-sm text-[#2563eb]">Refresh</button>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={() => fetchTab(tab)} className="ml-2 underline">Retry</button></div>}

      {fetching ? (
        <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
      ) : tab === 'feedback' ? (
        feedback.length === 0 ? <p className="text-center text-[#94a3b8] text-sm py-6">No deletion feedback yet.</p> : (
          <div className="space-y-2">
            {feedback.map(f => (
              <div key={f.id} className="rounded-xl p-3 text-sm" style={CARD}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[#475569] truncate">{f.email || '(no email)'}</span>
                  <span className="text-xs text-[#94a3b8] ml-auto">{dt(f.deletedAt)}</span>
                </div>
                {f.reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {f.reasons.map((r, i) => <span key={i} className="text-[11px] bg-[#eff6ff] text-[#2563eb] rounded-full px-2 py-0.5">{r}</span>)}
                  </div>
                )}
                {f.message && <p className="text-[#0f172a] mt-1.5 whitespace-pre-wrap break-words">{f.message}</p>}
              </div>
            ))}
          </div>
        )
      ) : (
        (() => {
          const shown = statusFilter === 'all' ? tickets : tickets.filter(t => t.status === statusFilter)
          return (
            <div className="space-y-2">
              <div className="flex gap-1">
                {(['all', 'open', 'resolved', 'closed'] as const).map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)} className={`text-xs px-2.5 py-1 rounded-full border ${statusFilter === s ? 'bg-[#2563eb] text-white border-[#2563eb]' : 'border-[var(--border)] text-[#475569]'}`}>
                    {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {shown.length === 0 ? <p className="text-center text-[#94a3b8] text-sm py-6">No tickets.</p> : shown.map(t => (
                <div key={t.id} className="rounded-xl p-3 text-sm" style={CARD}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {t.ticket && <span className="text-xs font-mono text-[#2563eb]">{t.ticket}</span>}
                    {t.topic && <span className="text-xs text-[#475569]">{t.topic}</span>}
                    <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 ${TICKET_STATUS_STYLE[t.status] ?? TICKET_STATUS_STYLE.open}`}>{t.status}</span>
                    <span className="text-[11px] text-[#94a3b8] ml-auto">{dt(t.updatedAt ?? t.createdAt)}</span>
                  </div>
                  <div className="text-[11px] text-[#94a3b8] mt-1">{t.name || '(no name)'} · {t.email || 'no email'}</div>
                  <div className="flex gap-2 mt-2">
                    {t.status !== 'resolved'
                      ? <button disabled={busyId === t.id} onClick={() => setTicketStatus(t.id, 'resolved')} className="text-xs text-emerald-700 disabled:opacity-50">Mark resolved</button>
                      : <button disabled={busyId === t.id} onClick={() => setTicketStatus(t.id, 'open')} className="text-xs text-[#2563eb] disabled:opacity-50">Reopen</button>}
                  </div>
                </div>
              ))}
            </div>
          )
        })()
      )}
    </div>
  )
}
