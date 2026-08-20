'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Health {
  mode: 'test' | 'live' | 'off'
  webhookConfigured: boolean
  priceConfigured: boolean
  priceValid: boolean | null
  priceError: string | null
  events: { last24h: number; last7d: number; latestAt: number | null; latestType: string | null }
  cohorts: Record<string, number>
  lastSweep: { at: number; scanned: number; trialsStarted: number; paywalled: number; errors: number } | null
}

interface Reconciliation {
  found: boolean
  uid?: string
  email?: string
  stored: Record<string, unknown> | null
  live: Record<string, unknown> | null
  drift: string[]
  note: string
}

const COHORT_LABEL: Record<string, string> = {
  legacy: 'No subscription yet',
  exempt: 'Complimentary',
  trialing: 'On free trial',
  active: 'Paying',
  grace: 'In grace window',
  dunning: 'Payment in progress',
  paused: 'Paused',
  paywalled: 'Paywalled',
}

interface Overview {
  configured: boolean
  config: { gstRegistered: boolean; gstEffectiveDate: string | null; gstInclusive: boolean }
  priceAud: number
  thresholdAud: number
  priceOverseas: string
  priceAu: string
  turnover: {
    auTaxable12mAud: number
    percentOfThreshold: number
    computedAt: number | null
    byMonth: { month: string; cents: number }[]
  }
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">{label}</p>
      <p className={`text-sm font-medium ${bad ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>{value}</p>
    </div>
  )
}

function Json({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[#94a3b8] mb-1">{title}</p>
      <pre className="text-[11px] bg-[#f8fafc] border border-[var(--border)] rounded-lg p-2 overflow-x-auto max-h-56">
        {value ? JSON.stringify(value, null, 2) : '—'}
      </pre>
    </div>
  )
}

const money = (aud: number) => `$${aud.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export default function BillingPanel() {
  const { user } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [lookup, setLookup] = useState('')
  const [recon, setRecon] = useState<Reconciliation | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [effectiveDate, setEffectiveDate] = useState('')

  const call = useCallback(async <T,>(body: Record<string, unknown>): Promise<T> => {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Request failed')
    return res.json() as Promise<T>
  }, [user])

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([
        call<Overview>({ action: 'overview' }),
        call<Health>({ action: 'health' }),
      ])
      setData(d)
      setHealth(h)
      setEffectiveDate(d.config.gstEffectiveDate ?? '')
    } catch (e) { setToast(e instanceof Error ? e.message : 'Failed to load') }
  }, [call])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

  async function runSweep() {
    setBusy(true)
    try {
      const r = await call<{ sweep: { trialsStarted: number; paywalled: number; errors: number } }>({ action: 'runSweep' })
      await load()
      setToast(`Sweep done — ${r.sweep.trialsStarted} trials started, ${r.sweep.paywalled} paywalled, ${r.sweep.errors} errors.`)
    } catch (e) { setToast(e instanceof Error ? e.message : 'Sweep failed') }
    finally { setBusy(false) }
  }

  async function reconcile() {
    if (!lookup.trim()) return
    setBusy(true); setRecon(null)
    try { setRecon(await call<Reconciliation>({ action: 'reconcile', lookup })) }
    catch (e) { setToast(e instanceof Error ? e.message : 'Lookup failed') }
    finally { setBusy(false) }
  }

  async function reproject(uid: string) {
    setBusy(true)
    try {
      await call({ action: 'reproject', uid })
      setRecon(await call<Reconciliation>({ action: 'reconcile', lookup }))
      setToast('Re-read from Stripe.')
    } catch (e) { setToast(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }

  async function refreshTurnover() {
    setBusy(true)
    try { await call({ action: 'refreshTurnover' }); await load(); setToast('Turnover recalculated from Stripe.') }
    catch (e) { setToast(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }

  async function toggleGst(registered: boolean) {
    if (registered && !window.confirm(
      'Register for GST in Stripe?\n\nAustralian customers keep paying the same $30 — the GST is carved out of it, not added on top — and their invoices become compliant tax invoices. Overseas customers are unaffected.'
    )) return
    setBusy(true)
    try {
      await call({ action: 'setGst', registered, effectiveDate: effectiveDate || null })
      await load()
      setToast(registered ? 'GST registration active in Stripe.' : 'GST registration expired.')
    } catch (e) { setToast(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(false) }
  }

  async function exportRecords() {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'recordsExport' }),
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lushnote-billing-records.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!data) return <div className="max-w-4xl mx-auto px-4 py-6 text-sm text-[#94a3b8]">Loading…</div>

  const pct = data.turnover.percentOfThreshold
  const tone = pct >= 100 ? 'text-[#dc2626]' : pct >= 80 ? 'text-amber-600' : 'text-[#0f172a]'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {!data.configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Stripe is not configured in this environment. Nothing below can change until the keys are set.
        </div>
      )}
      {toast && <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm text-[#475569]">{toast}</div>}

      {/* ── Pipeline health ── */}
      {health && (
        <div className="rounded-2xl p-5 space-y-3" style={CARD}>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-[#0f172a]">Pipeline health</h2>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
              health.mode === 'live' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : health.mode === 'test' ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-[#f1f5f9] text-[#475569] border-[var(--border)]'}`}>
              {health.mode === 'off' ? 'Stripe off' : `${health.mode} mode`}
            </span>
            <button onClick={runSweep} disabled={busy} className="ml-auto text-xs text-[#2563eb] disabled:opacity-50">
              Run nightly sweep now
            </button>
          </div>
          <p className="text-xs text-[#94a3b8]">
            Stripe fires an event, the webhook verifies and re-reads the subscription, and the result lands on the
            doctor&apos;s record. Everything below is that chain, reported from the app itself — there is nothing to
            check in a database console.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat
              label="Price"
              value={!health.priceConfigured ? 'Missing' : health.priceValid === false ? 'Invalid' : health.priceValid ? 'Valid' : 'Set'}
              bad={!health.priceConfigured || health.priceValid === false}
            />
            <Stat label="Webhook secret" value={health.webhookConfigured ? 'Set' : 'Missing'} bad={!health.webhookConfigured} />
            <Stat label="Events (24h)" value={String(health.events.last24h)} />
            <Stat label="Events (7d)" value={String(health.events.last7d)} />
          </div>

          {health.priceValid === false && (
            <div className="rounded-xl border border-[#dc2626]/30 bg-red-50 px-3 py-2 text-xs text-[#dc2626]">
              <strong>STRIPE_PRICE_ID does not resolve in {health.mode} mode.</strong> No trial can be created for
              anyone until this is fixed — onboarding, the nightly backfill and the Start trial button all fail.
              {health.priceError ? ` Stripe said: ${health.priceError}` : ''}
              {' '}A price id belongs to one mode only, so a live id will not work with test keys.
            </div>
          )}

          <p className="text-[11px] text-[#94a3b8]">
            {health.events.latestAt
              ? `Last event ${health.events.latestType ?? ''} at ${new Date(health.events.latestAt).toLocaleString('en-AU')}`
              : 'No webhook has been received yet. If Stripe is configured, send a test event from the Stripe dashboard.'}
          </p>

          {/* Cohorts: the same resolver the app gates on, counted. */}
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.keys(health.cohorts).length === 0
              ? <span className="text-xs text-[#94a3b8]">No doctors yet.</span>
              : Object.entries(health.cohorts).sort((a, b) => b[1] - a[1]).map(([state, n]) => (
                <span key={state} className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] bg-white">
                  {COHORT_LABEL[state] ?? state}: <strong>{n}</strong>
                </span>
              ))}
          </div>

          <p className="text-[11px] text-[#94a3b8]">
            {health.lastSweep
              ? `Nightly sweep last ran ${new Date(health.lastSweep.at).toLocaleString('en-AU')} — ${health.lastSweep.scanned} scanned, ${health.lastSweep.trialsStarted} trials started, ${health.lastSweep.paywalled} paywalled, ${health.lastSweep.errors} errors.`
              : 'The nightly sweep has not run since this was deployed.'}
          </p>
        </div>
      )}

      {/* ── One doctor: does the record match Stripe? ── */}
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <h2 className="text-base font-semibold text-[#0f172a]">Check a doctor&apos;s subscription</h2>
        <p className="text-xs text-[#94a3b8]">
          Reads what we stored and what Stripe says right now, and lists any field where they disagree. An empty
          result means the projection is current.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input value={lookup} onChange={e => setLookup(e.target.value)} placeholder="Email or uid"
            onKeyDown={e => { if (e.key === 'Enter') void reconcile() }}
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-[var(--border)] bg-white text-sm" />
          <button onClick={reconcile} disabled={busy || !lookup.trim()}
            className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-medium disabled:opacity-50">Check</button>
        </div>

        {recon && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-[#0f172a]">{recon.found ? (recon.email || recon.uid) : 'Not found'}</span>
              {recon.found && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  recon.drift.length ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                  {recon.drift.length ? `${recon.drift.length} field(s) differ` : 'In sync'}
                </span>
              )}
              {recon.found && recon.uid && recon.drift.length > 0 && (
                <button onClick={() => reproject(recon.uid!)} disabled={busy}
                  className="ml-auto text-xs text-[#2563eb] disabled:opacity-50">Re-read from Stripe</button>
              )}
            </div>
            <p className="text-xs text-[#475569]">{recon.note}</p>
            {recon.drift.length > 0 && (
              <ul className="text-xs text-amber-700 list-disc pl-5">
                {recon.drift.map(d => <li key={d}>{d}</li>)}
              </ul>
            )}
            {(recon.stored || recon.live) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Json title="Stored on the record" value={recon.stored} />
                <Json title="Live in Stripe" value={recon.live} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AU turnover vs the GST threshold ── */}
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-[#0f172a]">Australian turnover</h2>
          <button onClick={refreshTurnover} disabled={busy} className="ml-auto text-xs text-[#2563eb] disabled:opacity-50">Recalculate</button>
        </div>
        <p className="text-xs text-[#94a3b8]">
          Rolling 12 months, Australian customers only. Sales of services to overseas customers are GST-free exports
          and are deliberately excluded — counting them would put you over the threshold years early.
        </p>
        <div className="flex items-end gap-2">
          <span className={`text-3xl font-bold ${tone}`}>{money(data.turnover.auTaxable12mAud)}</span>
          <span className="text-sm text-[#94a3b8] pb-1">of {money(data.thresholdAud)} ({pct}%)</span>
        </div>
        <div className="h-2 rounded-full bg-[#e2e8f0] overflow-hidden">
          <div
            className={`h-full ${pct >= 100 ? 'bg-[#dc2626]' : pct >= 80 ? 'bg-amber-500' : 'bg-[#2563eb]'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        {pct >= 80 && pct < 100 && (
          <p className="text-xs text-amber-700">
            Approaching the threshold. Registration becomes compulsory once Australian turnover passes {money(data.thresholdAud)}
            {' '}in any rolling 12 months, and the ATO expects it within 21 days of that happening.
          </p>
        )}
        {pct >= 100 && (
          <p className="text-xs text-[#dc2626]">
            Over the threshold. Registration is compulsory — the ATO expects it within 21 days of crossing.
          </p>
        )}
        <p className="text-[11px] text-[#94a3b8]">
          {data.turnover.computedAt
            ? `Last recalculated ${new Date(data.turnover.computedAt).toLocaleString('en-AU')} · refreshes nightly`
            : 'Not yet calculated — runs with the nightly sweep.'}
        </p>
      </div>

      {/* ── GST registration ── */}
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <h2 className="text-base font-semibold text-[#0f172a]">GST registration</h2>
        <p className="text-xs text-[#94a3b8]">
          The price is tax-inclusive and fixed at ${data.priceAud}. Registering does not change what anyone pays — it
          changes what the invoice says, and only for Australians. Overseas customers keep seeing the same price with
          no GST, because exports of services are GST-free.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-sm font-medium ${data.config.gstRegistered ? 'text-[#059669]' : 'text-[#475569]'}`}>
            {data.config.gstRegistered ? 'Registered — collecting GST from Australian customers' : 'Not registered — no GST collected'}
          </span>
        </div>
        <label className="block">
          <span className="text-xs text-[#475569]">Effective date (optional)</span>
          <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)}
            className="mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-white text-sm" />
        </label>
        <div className="flex gap-2">
          {data.config.gstRegistered ? (
            <button onClick={() => toggleGst(false)} disabled={busy}
              className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569] disabled:opacity-50">
              End registration
            </button>
          ) : (
            <button onClick={() => toggleGst(true)} disabled={busy || !data.configured}
              className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-medium disabled:opacity-50">
              Register for GST
            </button>
          )}
        </div>
        <div className="text-xs text-[#475569] pt-1 space-y-0.5">
          <p>Overseas customers see: <strong>{data.priceOverseas}</strong></p>
          <p>Australian customers see: <strong>{data.priceAu}</strong></p>
        </div>
      </div>

      {/* ── Obligations elsewhere ── */}
      <div className="rounded-2xl p-5 space-y-2" style={CARD}>
        <h2 className="text-base font-semibold text-[#0f172a]">Obligations in other countries</h2>
        <p className="text-xs text-[#94a3b8]">
          Selling to doctors abroad can create a registration obligation in their country — the EU and UK can require
          one from the first sale. Stripe monitors those thresholds and is the authoritative view; there is no API for
          it, so this links out rather than mirroring numbers that could go stale.
        </p>
        <a href="https://dashboard.stripe.com/tax/thresholds" target="_blank" rel="noreferrer" className="text-sm text-[#2563eb]">
          Open Stripe Tax → Thresholds →
        </a>
      </div>

      {/* ── Records ── */}
      <div className="rounded-2xl p-5 space-y-2" style={CARD}>
        <h2 className="text-base font-semibold text-[#0f172a]">Records</h2>
        <p className="text-xs text-[#94a3b8]">
          Invoices and transactions live in Stripe, which is the system of record. This export is the consent and
          identity trail, including accounts that have since been deleted — kept five years as the ATO requires, and
          deliberately impossible to delete from here.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportRecords} className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569]">
            Export records (CSV)
          </button>
          <a href="https://dashboard.stripe.com/invoices" target="_blank" rel="noreferrer"
            className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569]">
            Invoices in Stripe →
          </a>
        </div>
      </div>
    </div>
  )
}
