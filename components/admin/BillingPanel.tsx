'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

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

const money = (aud: number) => `$${aud.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export default function BillingPanel() {
  const { user } = useAuth()
  const [data, setData] = useState<Overview | null>(null)
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
      const d = await call<Overview>({ action: 'overview' })
      setData(d)
      setEffectiveDate(d.config.gstEffectiveDate ?? '')
    } catch (e) { setToast(e instanceof Error ? e.message : 'Failed to load') }
  }, [call])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])

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
