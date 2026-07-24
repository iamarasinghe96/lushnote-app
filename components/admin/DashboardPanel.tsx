'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

interface Stats { users: number; notes: number; pendingLetterheadRequests: number; openTickets: number }

export default function DashboardPanel() {
  const { user } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetchStats() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function fetchStats() {
    setFetching(true); setError(null)
    try {
      const token = user ? await user.getIdToken() : ''
      const res = await fetch('/api/admin/overview', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'stats' }) })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? 'Request failed') }
      setStats((await res.json()).stats)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setFetching(false) }
  }

  const cells: { label: string; value: number | undefined }[] = [
    { label: 'Doctors', value: stats?.users },
    { label: 'Notes & letters', value: stats?.notes },
    { label: 'Open support tickets', value: stats?.openTickets },
    { label: 'Pending letterhead requests', value: stats?.pendingLetterheadRequests },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#0f172a]">Overview</h2>
        <button onClick={fetchStats} className="text-sm text-[#2563eb]">Refresh</button>
      </div>
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={fetchStats} className="ml-2 underline">Retry</button></div>}
      <div className="grid grid-cols-2 gap-3">
        {cells.map(c => (
          <div key={c.label} className="rounded-2xl p-5" style={CARD}>
            <div className="text-3xl font-bold text-[#0f172a]">{fetching || c.value === undefined ? '…' : (c.value < 0 ? '—' : c.value.toLocaleString())}</div>
            <div className="text-xs text-[#475569] mt-1">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#94a3b8]">Counts are aggregates — no clinical content is read to produce them.</p>
    </div>
  )
}
