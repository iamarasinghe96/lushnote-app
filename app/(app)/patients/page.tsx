'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { getPatientProfiles, deletePatientProfile } from '@/lib/firestore/patients'
import { listNotes } from '@/lib/firestore/notes'
import PatientModal from '@/components/modals/PatientModal'
import type { PatientProfile, Note } from '@/types'

function getAvatarColor(name: string): string {
  const colors = [
    '#2563eb', '#7c3aed', '#0891b2', '#059669',
    '#d97706', '#dc2626', '#db2777', '#65a30d',
  ]
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[index % colors.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function formatGender(g: string): string {
  const map: Record<string, string> = {
    male: 'Male', female: 'Female', other: 'Other', 'prefer-not-to-say': 'Prefer not to say',
  }
  return map[g] ?? g
}

function SkeletonCard() {
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4 animate-pulse"
         style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--bg)]" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-[var(--bg)] rounded w-2/5" />
          <div className="h-3 bg-[var(--bg)] rounded w-1/4" />
        </div>
      </div>
    </div>
  )
}

export default function PatientsPage() {
  const router = useRouter()
  const { user } = useAuth()

  const [profiles, setProfiles] = useState<Record<string, PatientProfile>>({})
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPatient, setEditingPatient] = useState<PatientProfile | undefined>()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    Promise.all([
      getPatientProfiles(user.uid),
      listNotes(user.uid),
    ]).then(([p, n]) => {
      setProfiles(p)
      setNotes(n)
    }).finally(() => setLoading(false))
  }, [user])

  // Note counts and last visit per patient name (case-insensitive)
  const noteMeta = useMemo(() => {
    const meta: Record<string, { count: number; lastVisit: string }> = {}
    for (const n of notes) {
      const key = n.patient.trim().toLowerCase()
      if (!key) continue
      if (!meta[key]) meta[key] = { count: 0, lastVisit: '' }
      meta[key].count++
      if (!meta[key].lastVisit || n.date > meta[key].lastVisit) {
        meta[key].lastVisit = n.date
      }
    }
    return meta
  }, [notes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return Object.values(profiles)
      .filter(p => !q || p.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [profiles, search])

  function openAdd() { setEditingPatient(undefined); setModalOpen(true) }
  function openEdit(p: PatientProfile) { setEditingPatient(p); setModalOpen(true) }

  function handleSaved(saved: PatientProfile) {
    if (!saved.id) return
    setProfiles(prev => ({ ...prev, [saved.id!]: saved }))
    setModalOpen(false)
  }

  async function handleDelete(id: string) {
    if (!user) return
    setDeletingId(id)
    try {
      await deletePatientProfile(user.uid, id)
      setProfiles(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } finally {
      setDeletingId(null)
    }
  }

  function goToHistory(name: string) {
    router.push(`/history?patient=${encodeURIComponent(name)}`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">

        <div className="mb-4">
          <h1 className="text-lg font-semibold text-[var(--text)]">Patients</h1>
          <p className="text-sm text-[var(--text2)]">{Object.keys(profiles).length} patient{Object.keys(profiles).length !== 1 ? 's' : ''}</p>
        </div>

        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search patients…"
          className="w-full mb-4 rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors"
        />

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--text3)]">
            <p className="text-sm">
              {search ? 'No patients match your search.' : 'No patients yet. Add your first patient.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map(p => {
              const key = p.displayName.trim().toLowerCase()
              const meta = noteMeta[key]
              const avatarColor = getAvatarColor(p.displayName)
              return (
                <li key={p.id}>
                  <div
                    className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4
                               hover:border-[var(--blue)]/40 transition-colors cursor-pointer"
                    style={{ boxShadow: 'var(--shadow-sm)' }}
                    onClick={() => goToHistory(p.displayName)}
                  >
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div
                        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center
                                   text-white text-sm font-bold"
                        style={{ backgroundColor: avatarColor }}
                      >
                        {getInitials(p.displayName)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[var(--text)] truncate">
                          {p.displayName}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          {p.dob && (
                            <span className="text-xs text-[var(--text2)]">{p.dob}</span>
                          )}
                          {p.gender && (
                            <span className="text-xs text-[var(--text3)]">{formatGender(p.gender)}</span>
                          )}
                          {meta && (
                            <>
                              <span className="text-xs text-[var(--text3)]">·</span>
                              <span className="text-xs text-[var(--text2)]">
                                {meta.count} note{meta.count !== 1 ? 's' : ''}
                              </span>
                              {meta.lastVisit && (
                                <>
                                  <span className="text-xs text-[var(--text3)]">·</span>
                                  <span className="text-xs text-[var(--text2)]">Last: {meta.lastVisit}</span>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => openEdit(p)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center
                                     text-[var(--text3)] hover:text-[var(--text)] hover:bg-[var(--bg)]
                                     transition-colors"
                          aria-label="Edit patient"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => p.id && handleDelete(p.id)}
                          disabled={deletingId === p.id}
                          className="w-8 h-8 rounded-lg flex items-center justify-center
                                     text-[var(--text3)] hover:text-[var(--danger)] hover:bg-red-50
                                     transition-colors disabled:opacity-40"
                          aria-label="Delete patient"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={openAdd}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-[#10b981] text-white
                   flex items-center justify-center shadow-lg
                   hover:bg-[#059669] active:scale-95 transition-all z-20"
        aria-label="Add patient"
        style={{ boxShadow: '0 4px 16px rgba(16,185,129,.35)' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      <PatientModal
        open={modalOpen}
        patient={editingPatient}
        onSave={handleSaved}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}
