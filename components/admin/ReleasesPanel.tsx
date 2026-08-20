'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import type { PullSummary, CheckSummary } from '@/lib/github'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Overview {
  configured: boolean
  error?: string
  site: string
  mainSha: string
  liveSha: string | null
  liveBuiltAt: string | null
  deploying: boolean
  pulls: PullSummary[]
}

const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '—')
const when = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleString() : '—' } catch { return '—' } }

const CHECK_LABEL: Record<string, string> = {
  quality: 'Types + unit tests',
  e2e: 'Browser suite',
}

function checkTone(c: CheckSummary): { text: string; bg: string; fg: string } {
  if (c.status === 'missing') return { text: 'not run', bg: '#f1f5f9', fg: '#64748b' }
  if (c.status !== 'completed') return { text: 'running', bg: '#fef3c7', fg: '#92400e' }
  if (c.conclusion === 'success' || c.conclusion === 'skipped') return { text: 'passed', bg: '#dcfce7', fg: '#166534' }
  return { text: c.conclusion ?? 'failed', bg: '#fee2e2', fg: '#991b1b' }
}

export default function ReleasesPanel() {
  const { user } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [overrideFor, setOverrideFor] = useState<number | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)

  const call = useCallback(async (body: Record<string, unknown>) => {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`)
    return json as Record<string, unknown>
  }, [user])

  const load = useCallback(async () => {
    if (!user) return
    setBusy(true); setError(null)
    try {
      setData(await call({ action: 'overview' }) as unknown as Overview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load releases')
    } finally {
      setBusy(false)
    }
  }, [user, call])

  useEffect(() => { void load() }, [load])

  // While production is mid-deploy the live sha is stale by definition, so the
  // panel keeps asking until it matches main. Stops the moment it does, so an
  // idle admin page is not polling GitHub every ten seconds forever.
  useEffect(() => {
    if (!data?.deploying) return
    const id = setInterval(() => { void load() }, 15_000)
    return () => clearInterval(id)
  }, [data?.deploying, load])

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true); setError(null); setNote(null)
    try {
      await call(body)
      setNote(success)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  async function provision() {
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await call({ action: 'provisionE2eUser' }) as { email: string; password: string }
      setCredentials({ email: r.email, password: r.password })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not provision the test account')
    } finally {
      setBusy(false)
    }
  }

  const live = data?.liveSha ?? null
  const isLive = !!data && !data.deploying && live === data.mainSha

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm text-red-700 bg-red-50 border border-red-200">{error}</div>
      )}
      {note && (
        <div className="rounded-xl px-4 py-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200">{note}</div>
      )}

      {/* ── What is live right now ─────────────────────────────────────── */}
      <div className="rounded-2xl p-4" style={CARD}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live now</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {short(live)}
              {data?.deploying && <span className="ml-2 text-sm font-normal text-amber-700">deploying {short(data.mainSha)}…</span>}
              {isLive && <span className="ml-2 text-sm font-normal text-emerald-700">up to date</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {data?.site} · built {when(data?.liveBuiltAt ?? null)} · main is at {short(data?.mainSha ?? null)}
            </p>
          </div>
          <button
            onClick={() => void load()} disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Refresh'}
          </button>
        </div>
      </div>

      {data && data.configured === false && (
        <div className="rounded-2xl p-4 text-sm text-slate-700" style={CARD}>
          {data.error ?? 'GitHub is not configured on this deployment.'}
          <p className="mt-2 text-xs text-slate-500">
            Set GITHUB_TOKEN (fine-grained, this repository only: Contents RW, Pull requests RW, Checks R, Actions RW)
            and GITHUB_REPO in the Vercel environment, then redeploy.
          </p>
        </div>
      )}

      {/* ── Waiting to be promoted ─────────────────────────────────────── */}
      {data?.configured && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Waiting to go live</p>

          {data.pulls.length === 0 && (
            <div className="rounded-2xl p-4 text-sm text-slate-500" style={CARD}>Nothing open. Production matches main.</div>
          )}

          {data.pulls.map(pull => {
            const ready = !pull.blockedReason
            return (
              <div key={pull.number} className="rounded-2xl p-4 space-y-3" style={CARD}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{pull.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      #{pull.number} · {pull.branch} · {short(pull.headSha)} · {pull.changedFiles} file{pull.changedFiles === 1 ? '' : 's'}
                      {' '}(+{pull.additions} −{pull.deletions}) · updated {when(pull.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={pull.url} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700">
                      Diff
                    </a>
                    {pull.previewUrl ? (
                      <a href={pull.previewUrl} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-lg bg-[var(--blue)] text-white font-medium">
                        Open preview
                      </a>
                    ) : (
                      // Two very different causes, and blaming Vercel for a
                      // token gap sent the last debug down the wrong path.
                      <span
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400"
                        title={pull.checks.every(c => c.status === 'missing')
                          ? 'Either Vercel has not finished building, or the GitHub token is missing Deployments: Read.'
                          : 'Vercel has not reported a successful preview deployment for this commit yet.'}
                      >
                        No preview yet
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {pull.checks.map(c => {
                    const tone = checkTone(c)
                    return (
                      <span key={c.name} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full" style={{ background: tone.bg, color: tone.fg }}>
                        <span className="font-medium">{CHECK_LABEL[c.name] ?? c.name}</span>
                        <span>{tone.text}</span>
                        {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="underline">log</a>}
                        {c.workflowRunId && (
                          <button onClick={() => void act({ action: 'rerun', workflowRunId: c.workflowRunId }, `Re-running ${c.name}`)} disabled={busy} className="underline disabled:opacity-50">
                            re-run
                          </button>
                        )}
                      </span>
                    )
                  })}
                </div>

                {ready ? (
                  <button
                    onClick={() => void act({ action: 'promote', number: pull.number, headSha: pull.headSha }, `#${pull.number} promoted — production is deploying`)}
                    disabled={busy}
                    className="w-full py-2.5 rounded-xl bg-[#10b981] text-white text-sm font-semibold disabled:opacity-50 motion-safe:active:scale-[0.99]"
                  >
                    Promote to live
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button disabled className="w-full py-2.5 rounded-xl bg-slate-100 text-slate-400 text-sm font-semibold cursor-not-allowed">
                      Promote to live — {pull.blockedReason}
                    </button>
                    {overrideFor === pull.number ? (
                      <div className="space-y-2">
                        <input
                          value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                          placeholder="Why is this being shipped anyway?"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => { setOverrideFor(null); setOverrideReason('') }} className="flex-1 py-2 rounded-lg border border-slate-300 text-sm text-slate-700">
                            Cancel
                          </button>
                          <button
                            disabled={busy || overrideReason.trim().length < 10}
                            onClick={() => { void act({ action: 'promote', number: pull.number, headSha: pull.headSha, override: true, reason: overrideReason.trim() }, `#${pull.number} promoted with an override`); setOverrideFor(null); setOverrideReason('') }}
                            className="flex-1 py-2 rounded-lg bg-[var(--danger)] text-white text-sm font-semibold disabled:opacity-50"
                          >
                            Promote anyway
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setOverrideFor(pull.number)} className="text-xs text-slate-500 underline">
                        Override — ship without a green check
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── One-time setup ─────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4 space-y-3" style={CARD}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Setup</p>
          <p className="mt-1 text-sm text-slate-700">
            The browser suite signs in as a dedicated non-admin account. Provisioning issues a new password —
            copy it into the repository secrets, because it is shown once and cannot be read back.
          </p>
        </div>

        {credentials ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-900">Copy these into GitHub → Settings → Secrets → Actions</p>
            <p className="text-xs font-mono break-all text-amber-900">E2E_USER_EMAIL = {credentials.email}</p>
            <p className="text-xs font-mono break-all text-amber-900">E2E_USER_PASSWORD = {credentials.password}</p>
            <button onClick={() => setCredentials(null)} className="text-xs underline text-amber-900">Done, hide this</button>
          </div>
        ) : (
          <button onClick={() => void provision()} disabled={busy} className="text-sm px-4 py-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-50">
            Provision test account
          </button>
        )}
      </div>
    </div>
  )
}
