'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  LIFECYCLE_LABEL, LIFECYCLE_WHEN, LIFECYCLE_TYPES, PLACEHOLDERS, renderLifecycleEmail,
  type LifecycleEmailType,
} from '@/lib/emails/lifecycle'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

// Imported, not restated. These constants used to be a second copy that had to
// be edited in step with the server's — and the preview below re-implemented the
// substitution too, so a new placeholder silently rendered as literal braces in
// the editor while sending correctly. lib/emails/lifecycle.ts is pure, so there
// is no reason for a client component not to read it directly.
type EmailType = LifecycleEmailType
const LABEL = LIFECYCLE_LABEL
const WHEN = LIFECYCLE_WHEN
const TYPES = LIFECYCLE_TYPES

interface Template { subject: string; body: string; customised: boolean }
interface LogRow { id: string; uid: string; email: string; type: EmailType; subject: string; ok: boolean; error?: string | null; at: number }

const when = (ms: number) => { try { return new Date(ms).toLocaleString() } catch { return '—' } }

export default function EmailsPanel() {
  const { user } = useAuth()
  const [configured, setConfigured] = useState(true)
  const [due, setDue] = useState<{ type: EmailType; n: number }[]>([])
  const [templates, setTemplates] = useState<Record<EmailType, Template> | null>(null)
  const [log, setLog] = useState<LogRow[]>([])
  const [editing, setEditing] = useState<EmailType>('welcome')
  const [draft, setDraft] = useState<{ subject: string; body: string }>({ subject: '', body: '' })
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

  const applyTemplates = useCallback((t: Record<EmailType, Template>, forType: EmailType) => {
    setTemplates(t)
    setDraft({ subject: t[forType].subject, body: t[forType].body })
  }, [])

  const load = useCallback(async () => {
    if (!user) return
    setBusy(true); setError(null)
    try {
      const r = await call({ action: 'overview' })
      setConfigured(r.configured !== false)
      setDue((r.due as { type: EmailType; n: number }[]) ?? [])
      setLog((r.log as LogRow[]) ?? [])
      applyTemplates(r.templates as Record<EmailType, Template>, editing)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
    finally { setBusy(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, call, applyTemplates])

  useEffect(() => { void load() }, [load])

  function switchTo(type: EmailType) {
    setEditing(type)
    setNote(null)
    if (templates) setDraft({ subject: templates[type].subject, body: templates[type].body })
  }

  const dirty = !!templates && (draft.subject !== templates[editing].subject || draft.body !== templates[editing].body)

  async function save() {
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await call({ action: 'saveTemplate', type: editing, subject: draft.subject, template: draft.body })
      applyTemplates(r.templates as Record<EmailType, Template>, editing)
      setNote('Saved. The next automatic send uses this wording.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') }
    finally { setBusy(false) }
  }

  async function reset() {
    if (!window.confirm('Discard your edits and restore the original wording?')) return
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await call({ action: 'resetTemplate', type: editing })
      applyTemplates(r.templates as Record<EmailType, Template>, editing)
      setNote('Restored the original wording.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reset') }
    finally { setBusy(false) }
  }

  // The server's own renderer, not a copy of it — the preview is then the email.
  const preview = renderLifecycleEmail(
    { subject: draft.subject, body: draft.body },
    { displayName: 'Dr Jane Smith', unsubscribeUrl: '#', trialEnd: '14 February 2027', price: 'AUD $30/month' },
  ).text

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Email isn&apos;t configured on the server yet. Set <code>ZOHO_SMTP_USER</code> and <code>ZOHO_SMTP_PASS</code> in Vercel — nothing will send until then.
        </div>
      )}

      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-[#0f172a]">Lifecycle emails</h2>
          <button disabled={busy} onClick={() => void load()}
            className="ml-auto px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569] disabled:opacity-50">Refresh</button>
        </div>
        <p className="text-xs text-[#94a3b8]">
          These send automatically — the welcome the moment a doctor finishes signing up, the rest on the daily 9am job. Nothing here needs to be triggered by hand.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TYPES.map(t => {
            const n = due.find(d => d.type === t)?.n ?? 0
            return (
              <div key={t} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">{LABEL[t]}</p>
                <p className="text-xl font-bold text-[#0f172a]">{n}</p>
                <p className="text-[11px] text-[#94a3b8]">queued for the next run</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Draft editor */}
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <div className="flex flex-wrap gap-2">
          {TYPES.map(t => (
            <button key={t} onClick={() => switchTo(t)}
              className={`px-3 py-1.5 rounded-lg text-sm ${editing === t ? 'bg-[#1d4ed8] text-white' : 'text-[#475569] border border-[var(--border)]'}`}>
              {LABEL[t]}{templates?.[t].customised ? ' ·' : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#94a3b8]">{WHEN[editing]}</p>

        <label className="block">
          <span className="text-xs font-medium text-[#475569]">Subject</span>
          <input value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}
            className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-[#475569]">Body</span>
          <textarea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
            rows={16}
            className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb] font-mono leading-relaxed" />
        </label>

        <p className="text-xs text-[#94a3b8]">
          Placeholders: {PLACEHOLDERS.map(p => <code key={p} className="mr-2">{p}</code>)}
          — blank lines separate paragraphs, and <code>[label](https://…)</code> becomes a link. The unsubscribe footer is added automatically.
        </p>

        <div className="flex flex-wrap gap-2 items-center">
          <button disabled={busy || !dirty} onClick={() => void save()}
            className="px-3 py-2 rounded-lg bg-[#10b981] text-white text-sm disabled:opacity-50">Save draft</button>
          <button disabled={busy || !templates?.[editing].customised} onClick={() => void reset()}
            className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569] disabled:opacity-50">Restore original</button>
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
          {note && <span className="text-xs text-[#059669]">{note}</span>}
          {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide text-[#94a3b8] mb-2">Preview</p>
          <p className="text-sm font-semibold text-[#0f172a] mb-2">{draft.subject}</p>
          <p className="text-sm text-[#0f172a] whitespace-pre-wrap leading-relaxed">{preview}</p>
        </div>
      </div>

      {/* Audit */}
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <h3 className="text-sm font-semibold text-[#0f172a]">Sent ({log.length})</h3>
        {log.length === 0
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
            </ul>}
      </div>
    </div>
  )
}
