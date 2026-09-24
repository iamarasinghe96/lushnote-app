'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import BackButton from '@/components/ui/BackButton'
import { formatMicros, microsToAud } from '@/lib/aiCost'
import { paidSpend, fairUseLevel, allowanceResetsOn, FAIR_USE_ALLOWANCE_MICROS, type FairUse } from '@/lib/fairUse'
import { isProState, type EntitlementState } from '@/lib/entitlement'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Workplace { name: string; type: string }
interface UserRow {
  uid: string; email: string; displayName: string; credentials: string; status: string; tier: string
  position?: string; workPhone?: string; workplaces: Workplace[]
  onboardingComplete: boolean; termsAccepted: boolean; marketingConsent: boolean
  geminiUsage: unknown; aiCost: unknown; createdAt: number | null; updatedAt: number | null
  billingSummary?: {
    subscriptionStatus: string | null; trialEndsAt: number | null; currentPeriodEnd: number | null
    cancelAtPeriodEnd: boolean; paused: boolean
    paymentMethodType: string | null; paymentMethodStatus: string | null
    country: string | null; gracePeriodEnd: number | null; paywalledAt: number | null
    billingExempt: boolean; enterpriseSince: number | null
    stripeCustomerId: string | null; subscriptionId: string | null
  } | null
  entitlementState: EntitlementState
  fairUse: FairUse
}
interface UserDetail extends UserRow { noteCount: number; patientCount: number; authDisabled: boolean | null; lastSignIn: number | null }

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '-')
const dt = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '-')

function StatusBadge({ status }: { status: string }) {
  const s = status === 'disabled'
    ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return <span className={`text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 ${s}`}>{status}</span>
}

const pct = (share: number) => `${Math.round(share * 100)}%`

/** One word on the list, only where there is something to look at. */
function FairUseChip({ f }: { f: FairUse }) {
  if (f.enterprise) {
    return <span className="text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 bg-blue-50 text-[#2563eb] border-blue-200">enterprise</span>
  }
  if (f.level === 'exceeded') {
    return <span className="text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 bg-red-50 text-red-700 border-red-200">over fair use · {pct(f.share)}</span>
  }
  if (f.level === 'approaching') {
    return <span className="text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200">fair use {pct(f.share)}</span>
  }
  return null
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
  // Accounts at or past the warning line, heaviest first. The question an
  // admin opens this panel with when a month's AI bill looks wrong.
  const [fairUseOnly, setFairUseOnly] = useState(false)

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

  // Exemption lives on the billing admin route, not the users one, so the audit
  // trail for money decisions stays in one place.
  async function toggleExempt(u: UserDetail) {
    const next = !u.billingSummary?.billingExempt
    if (next && !window.confirm(`Make ${u.displayName || u.email} permanently free?\n\nThey keep full access regardless of their subscription. Reversible at any time.`)) return
    setBusy(true)
    try {
      const token = user ? await user.getIdToken() : ''
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'setExempt', uid: u.uid, exempt: next }),
      })
      if (!res.ok) throw new Error('Failed')
      setToast(next ? 'Marked permanently free' : 'Exemption removed')
      await openUser(u.uid)
    } catch (e) { setToast(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) }
  }

  // Beside exemption on the billing admin route, so money decisions audit in
  // one place. Changes whose key pays for the AI, never what is charged.
  async function toggleEnterprise(u: UserDetail) {
    const next = !u.billingSummary?.enterpriseSince
    const who = u.displayName || u.email
    const ok = window.confirm(next
      ? `Move ${who} to Enterprise?\n\nTheir AI stops running on LushNote's key and runs on their own organisation's key instead, billed to them by Google. The subscription itself is unchanged. Only do this once they have agreed to it.`
      : `Return ${who} to the standard plan?\n\nLushNote's key serves their AI again, up to the monthly fair-use allowance.`)
    if (!ok) return
    setBusy(true)
    try {
      const token = user ? await user.getIdToken() : ''
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'setEnterprise', uid: u.uid, enterprise: next }),
      })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Failed')
      setToast(next ? 'Moved to Enterprise' : 'Back on the standard plan')
      await openUser(u.uid)
      await fetchList()
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
    const matched = q
      ? users.filter(u => `${u.displayName} ${u.email} ${u.workplaces.map(w => w.name).join(' ')}`.toLowerCase().includes(q))
      : users
    if (!fairUseOnly) return matched
    return matched
      .filter(u => u.fairUse.level !== 'within')
      .sort((a, b) => b.fairUse.share - a.fairUse.share)
  }, [users, search, fairUseOnly])

  const overCount = users.filter(u => u.fairUse.level === 'exceeded').length
  const nearCount = users.filter(u => u.fairUse.level === 'approaching').length

  const gemini = (() => {
    const g = selected?.geminiUsage as Record<string, { count?: number; tokens?: number; promptTokens?: number; outputTokens?: number; thoughtsTokens?: number; date?: string }> | null
    const f = g?.['gemini-2.5-flash']
    if (!f) return '-'
    // Google's own counts, straight off each response — never estimated.
    const parts = [`${f.count ?? 0} req`]
    if (f.tokens) parts.push(`${f.tokens.toLocaleString()} tok`)
    if (f.promptTokens || f.outputTokens) parts.push(`${(f.promptTokens ?? 0).toLocaleString()} in / ${(f.outputTokens ?? 0).toLocaleString()} out`)
    if (f.thoughtsTokens) parts.push(`${f.thoughtsTokens.toLocaleString()} thinking`)
    return `${parts.join(' · ')}${f.date ? ` (${f.date})` : ''}`
  })()

  // Estimated, and labelled as such wherever it is shown. It is our arithmetic
  // over provider-reported token counts, not a bill.
  const aiSpend = (() => {
    const c = selected?.aiCost as Record<string, { micros?: number; calls?: number; unpriced?: number }> | null
    if (!c) return '-'
    const months = Object.keys(c).sort()
    const latest = months[months.length - 1]
    const m = latest ? c[latest] : null
    if (!m) return '-'
    const parts = [`~${formatMicros(m.micros ?? 0)} (${latest})`]
    if (m.calls) parts.push(`${m.calls} calls`)
    // A model with no price entry would otherwise read as free.
    if (m.unpriced) parts.push(`${m.unpriced} unpriced`)
    return parts.join(' · ')
  })()

  // The months before this one, on LushNote's keys only. One heavy month is a
  // busy clinic; the same account over every month is a shared login.
  const fairUseHistory = (() => {
    const c = selected?.aiCost as Record<string, { paid?: number }> | null
    if (!c || !selected) return []
    return Object.keys(c).sort().reverse()
      .filter(m => m !== selected.fairUse.month)
      .slice(0, 3)
      .map(m => {
        const paid = paidSpend(c[m])
        return { month: m, paid, level: fairUseLevel(paid, FAIR_USE_ALLOWANCE_MICROS) }
      })
  })()

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Detail view */}
      {selected ? (
        <div className="rounded-2xl p-5 space-y-4" style={CARD}>
          <BackButton onClick={() => setSelected(null)} label="Back to all users" />
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-[#0f172a]">{selected.displayName || '(no name)'}</h2>
            <StatusBadge status={selected.status} />
            {selected.tier === 'admin' && <span className="text-[10px] font-semibold uppercase border rounded-full px-1.5 py-0.5 bg-blue-50 text-[#2563eb] border-blue-200">admin</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label="Email" value={selected.email} />
            <Field label="Credentials" value={selected.credentials || '-'} />
            <Field label="Workplace" value={selected.workplaces[0]?.name || '-'} />
            <Field label="Position" value={selected.position || '-'} />
            <Field label="Notes" value={selected.noteCount < 0 ? '-' : String(selected.noteCount)} />
            <Field label="Patients" value={selected.patientCount < 0 ? '-' : String(selected.patientCount)} />
            <Field label="Gemini usage" value={gemini} />
            <Field label="AI cost (estimated)" value={aiSpend} />
            <div>
              <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">AI errors</p>
              {/* A plain link, not a router push: the console reads ?q= on mount,
                  so a full navigation is what actually applies the filter. */}
              <a href={`/admin?section=logs&q=${encodeURIComponent(selected.uid)}`}
                 className="text-sm text-[#2563eb] underline">
                View this user&apos;s AI failures →
              </a>
            </div>
            <Field label="Marketing consent" value={selected.marketingConsent ? 'Yes' : 'No'} />
            <Field label="Signed up" value={day(selected.createdAt)} />
            <Field label="Last sign-in" value={dt(selected.lastSignIn)} />
          </div>
          {/* ── Fair use ── */}
          {/* LushNote-paid AI only: calls their own key served cost us nothing
              and are not counted. Estimated, like every cost figure here. */}
          <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">Fair use · {selected.fairUse.month}</p>
              <FairUseChip f={selected.fairUse} />
              <span className="text-[11px] text-[#94a3b8]">estimated</span>
            </div>
            {selected.fairUse.enterprise ? (
              <p className="text-sm text-[#475569]">
                Enterprise since {day(selected.billingSummary?.enterpriseSince ?? null)}. Their AI runs on their own
                organisation&apos;s key and is billed to them by Google, so no allowance applies. Anything shown as
                LushNote-paid below is the shared Groq safety net.
              </p>
            ) : !isProState(selected.entitlementState) ? (
              <p className="text-sm text-[#475569]">
                Not on a paid plan ({selected.entitlementState}), so their AI runs on their own key and no allowance applies.
              </p>
            ) : null}
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-[#0f172a] font-medium">
                  {formatMicros(selected.fairUse.paidMicros)} of {formatMicros(selected.fairUse.allowanceMicros)} on LushNote&apos;s keys
                </span>
                <span className="text-[#475569] shrink-0">{pct(selected.fairUse.share)}</span>
              </div>
              <div className="h-2 rounded-full bg-[#e2e8f0] overflow-hidden" aria-hidden>
                <div className={`h-full rounded-full ${selected.fairUse.level === 'exceeded' ? 'bg-red-500' : selected.fairUse.level === 'approaching' ? 'bg-amber-400' : 'bg-emerald-500'}`}
                     style={{ width: `${Math.min(100, selected.fairUse.share * 100)}%` }} />
              </div>
              <p className="text-[11px] text-[#94a3b8]">
                About AUD ${microsToAud(selected.fairUse.paidMicros).toFixed(2)} against the AUD $30 they pay. The allowance is
                what one subscription nets after fees; past it LushNote is paying for their AI. All metered AI this month,
                their own key included: {formatMicros(selected.fairUse.totalMicros)}.
              </p>
              {selected.fairUse.level === 'exceeded' && !selected.fairUse.enterprise && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                  Over the allowance: their AI is back on their own key until {allowanceResetsOn(selected.fairUse.month)}, and
                  they are being shown the Enterprise option. Nothing is blocked. If one account is being shared across
                  a practice, Enterprise is the conversation to have.
                </p>
              )}
            </div>
            {fairUseHistory.length > 0 && (
              <ul className="text-xs divide-y divide-[var(--border)]">
                {fairUseHistory.map(h => (
                  <li key={h.month} className="py-1 flex items-center gap-2">
                    <span className="text-[#475569] w-16">{h.month}</span>
                    <span className="flex-1 text-[#0f172a]">{formatMicros(h.paid)}</span>
                    <span className={h.level === 'exceeded' ? 'text-red-700' : h.level === 'approaching' ? 'text-amber-700' : 'text-[#94a3b8]'}>
                      {pct(h.paid / FAIR_USE_ALLOWANCE_MICROS)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {selected.billingSummary && (
              <button onClick={() => toggleEnterprise(selected)} disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[#475569] disabled:opacity-50">
                {selected.billingSummary.enterpriseSince ? 'Return to standard plan' : 'Move to Enterprise'}
              </button>
            )}
          </div>

          {/* ── Billing ── */}
          {selected.billingSummary && (
            <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">Subscription</p>
                {selected.billingSummary.billingExempt && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Exempt - permanently free</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Field label="Status" value={selected.billingSummary.paused ? 'paused' : (selected.billingSummary.subscriptionStatus ?? '-')} />
                <Field label="Trial ends" value={day(selected.billingSummary.trialEndsAt)} />
                <Field label={selected.billingSummary.cancelAtPeriodEnd ? 'Access ends' : 'Renews'} value={day(selected.billingSummary.currentPeriodEnd)} />
                <Field label="Payment method" value={
                  selected.billingSummary.paymentMethodType
                    ? `${selected.billingSummary.paymentMethodType === 'au_becs_debit' ? 'Bank account' : 'Card'} (${selected.billingSummary.paymentMethodStatus})`
                    : 'None'
                } />
                <Field label="Country" value={selected.billingSummary.country ?? '-'} />
                <Field label="Paywalled" value={selected.billingSummary.paywalledAt ? day(selected.billingSummary.paywalledAt) : 'No'} />
              </div>
              <div className="flex flex-wrap gap-3 items-center pt-1">
                <button onClick={() => toggleExempt(selected)} disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[#475569] disabled:opacity-50">
                  {selected.billingSummary.billingExempt ? 'Remove exemption' : 'Make permanently free'}
                </button>
                {/* Identifiers, not secrets — refunds and disputes are handled in
                    Stripe, which is the system of record for both. */}
                {selected.billingSummary.stripeCustomerId && (
                  <a href={`https://dashboard.stripe.com/customers/${selected.billingSummary.stripeCustomerId}`}
                     target="_blank" rel="noreferrer" className="text-xs text-[#2563eb] underline">Customer in Stripe →</a>
                )}
                {selected.billingSummary.subscriptionId && (
                  <a href={`https://dashboard.stripe.com/subscriptions/${selected.billingSummary.subscriptionId}`}
                     target="_blank" rel="noreferrer" className="text-xs text-[#2563eb] underline">Subscription →</a>
                )}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[#94a3b8]">Clinical content is never shown here - counts only, to preserve patient confidentiality.</p>
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

          {/* Fair use at a glance. Tapping it narrows the list to the accounts
              behind the number, heaviest first. */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setFairUseOnly(false)}
              className={`text-xs px-3 py-1.5 rounded-full border ${!fairUseOnly ? 'bg-[#0f172a] text-white border-[#0f172a]' : 'border-[var(--border)] text-[#475569]'}`}>
              All users
            </button>
            <button onClick={() => setFairUseOnly(true)}
              className={`text-xs px-3 py-1.5 rounded-full border ${fairUseOnly ? 'bg-[#0f172a] text-white border-[#0f172a]' : 'border-[var(--border)] text-[#475569]'}`}>
              Fair use{overCount + nearCount > 0 ? ` · ${overCount} over, ${nearCount} near` : ''}
            </button>
            {fairUseOnly && (
              <span className="text-[11px] text-[#94a3b8]">
                LushNote-paid AI this month at 80% or more of the {formatMicros(FAIR_USE_ALLOWANCE_MICROS)} allowance. Estimated.
              </span>
            )}
          </div>

          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={fetchList} className="ml-2 underline">Retry</button></div>}

          {fetching || loadingDetail ? (
            <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-[#94a3b8] text-sm py-6">{fairUseOnly ? 'Nobody is near the fair-use allowance this month.' : 'No users match.'}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-[#94a3b8]">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</p>
              {filtered.map(u => (
                <button key={u.uid} onClick={() => openUser(u.uid)} className="w-full text-left rounded-xl p-3 flex items-center gap-3 hover:brightness-95" style={CARD}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[#0f172a] truncate">{u.displayName || '(no name)'}</span>
                      <StatusBadge status={u.status} />
                      <FairUseChip f={u.fairUse} />
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
