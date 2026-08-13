'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

type EmailType = 'welcome' | 'apiSetup' | 'inactive'
const LABEL: Record<EmailType, string> = {
  welcome: 'Welcome',
  apiSetup: 'API setup (day 7)',
  inactive: 'Inactive (7d idle)',
}

interface Candidate { uid: string; email: string; displayName: string; type: EmailType; reason: string }
interface LogRow { id: string; uid: string; email: string; type: EmailType; subject: string; ok: boolean; error?: string | null; at: number }

const when = (ms: number) => { try { return new Date(ms).toLocaleString() } catch { return '—' } }

export default function EmailsPanel() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'due' | 'sent'>('due')
  const [configured, setConfigured] = useState(true)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [log, setLog] = useState<LogRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const call = useCallback(async (body: Record<string, unknown>) => {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/lifecycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
    return data as Record<string, unknown>
  }, [user])

  const load = useCallback(async () => {
    if (!user) return
    setBusy(true); setError(null)
    try {
      const [due, sent] = await Promise.all([call({ action: 'preview' }), call({ action: 'log' })])
      setConfigured(due.configured !== false)
      setCandidates((due.candidates as Candidate[]) ?? [])
      setLog((sent.log as LogRow[]) ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
    finally { setBusy(false) }
  }, [user, call])

  useEffect(() => { void load() }, [load])

  async function run(dryRun: boolean) {
    if (!dryRun && !window.confirm(`Send ${candidates.length} email${candidates.length === 1 ? '' : 's'} now?`)) return
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await call({ action: 'run', dryRun })
      setNote(dryRun
        ? `Dry run: ${r.sent} of ${r.due} would be sent. Nothing was delivered.`
        : `Sent ${r.sent} of ${r.due}${r.failed ? `, ${r.failed} failed` : ''}.`)
      if (!dryRun) await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Run failed') }
    finally { setBusy(false) }
  }

  const counts = (['welcome', 'apiSetup', 'inactive'] as EmailType[])
    .map(t => ({ type: t, n: candidates.filter(c => c.type === t).length }))

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Email isn&apos;t configured on the server yet. Set <code>ZOHO_SMTP_USER</code> and <code>ZOHO_SMTP_PASS</code> in Vercel.
          Until then only a dry run will work.
        </div>
      )}

      <div className="rounded-2xl p-5 space-y-4" style={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-[#0f172a]">Lifecycle emails</h2>
          <div className="ml-auto flex gap-2">
            <button disabled={busy} onClick={() => void load()}
              className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569] disabled:opacity-50">Refresh</button>
            <button disabled={busy || !candidates.length} onClick={() => void run(true)}
              className="px-3 py-2 rounded-lg border border-[#2563eb] text-sm text-[#2563eb] disabled:opacity-50">Dry run</button>
            <button disabled={busy || !candidates.length || !configured} onClick={() => void run(false)}
              className="px-3 py-2 rounded-lg bg-[#10b981] text-white text-sm disabled:opacity-50">Send now</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {counts.map(c => (
            <div key={c.type} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">{LABEL[c.type]}</p>
              <p className="text-xl font-bold text-[#0f172a]">{c.n}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#94a3b8]">
          The daily job sends these automatically. Anything listed here is waiting for the next run — use Send now only to push it early.
        </p>

        {note && <p className="text-sm text-[#059669]">{note}</p>}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>

      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <div className="flex gap-2">
          {(['due', 'sent'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-sm ${tab === t ? 'bg-[#1d4ed8] text-white' : 'text-[#475569] border border-[var(--border)]'}`}>
              {t === 'due' ? `Due (${candidates.length})` : `Sent (${log.length})`}
            </button>
          ))}
        </div>

        {tab === 'due' ? (
          candidates.length === 0
            ? <p className="text-center text-[#94a3b8] text-sm py-6">Nobody is due an email.</p>
            : <ul className="divide-y divide-[var(--border)]">
                {candidates.map(c => (
                  <li key={`${c.uid}-${c.type}`} className="py-2.5 flex items-start gap-3">
                    <span className="text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 bg-blue-50 text-[#2563eb] border-blue-200 shrink-0 mt-0.5">{LABEL[c.type]}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-[#0f172a] truncate">{c.displayName || '(no name)'} · {c.email}</p>
                      <p className="text-xs text-[#94a3b8]">{c.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
        ) : (
          log.length === 0
            ? <p className="text-center text-[#94a3b8] text-sm py-6">Nothing sent yet.</p>
            : <ul className="divide-y divide-[var(--border)]">
                {log.map(l => (
                  <li key={l.id} className="py-2.5 flex items-start gap-3">
                    <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 shrink-0 mt-0.5 ${l.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                      {l.ok ? 'sent' : 'failed'}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-[#0f172a] truncate">{l.subject}</p>
                      <p className="text-xs text-[#94a3b8] truncate">{l.email} · {LABEL[l.type] ?? l.type} · {when(l.at)}</p>
                      {l.error && <p className="text-xs text-[var(--danger)]">{l.error}</p>}
                    </div>
                  </li>
                ))}
              </ul>
        )}
      </div>
    </div>
  )
}
