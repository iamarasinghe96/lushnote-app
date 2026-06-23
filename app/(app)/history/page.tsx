'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { listNotes } from '@/lib/firestore/notes'
import { getPatientProfiles } from '@/lib/firestore/patients'
import { GenderAvatar } from '@/components/ui/GenderAvatar'
import type { Note, PatientProfile } from '@/types'

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

function NoteCardSkeleton() {
  return (
    <div className="rounded-[var(--r)] border border-[var(--border)] bg-white p-3 animate-pulse"
         style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="h-3 bg-[var(--bg)] rounded w-1/3 mb-2" />
      <div className="h-3 bg-[var(--bg)] rounded w-3/4" />
    </div>
  )
}

function PatientRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 animate-pulse">
      <div className="w-7 h-7 rounded-full bg-[var(--bg)] shrink-0" />
      <div className="flex-1 h-3 bg-[var(--bg)] rounded" />
    </div>
  )
}

// Derive unique patient names from notes + profiles
function buildPatientList(
  notes: Note[],
  profiles: Record<string, PatientProfile>
): Array<{ name: string; count: number; lastVisit: string; gender?: PatientProfile['gender'] }> {
  const map = new Map<string, { count: number; lastVisit: string; normKey: string }>()

  // Seed from profiles so patients with no notes still appear
  for (const p of Object.values(profiles)) {
    const norm = p.displayName.trim().toLowerCase()
    if (!map.has(norm)) map.set(norm, { count: 0, lastVisit: '', normKey: norm })
  }

  for (const n of notes) {
    const name = n.patient?.trim()
    if (!name) continue
    const norm = name.toLowerCase()
    const existing = map.get(norm)
    if (existing) {
      existing.count++
      if (!existing.lastVisit || n.date > existing.lastVisit) existing.lastVisit = n.date
    } else {
      map.set(norm, { count: 1, lastVisit: n.date, normKey: norm })
    }
  }

  // Resolve display name: prefer profile name, else first note's patient value
  const profilesByNorm: Record<string, string> = {}
  for (const p of Object.values(profiles)) {
    profilesByNorm[p.displayName.trim().toLowerCase()] = p.displayName
  }
  const noteNameByNorm: Record<string, string> = {}
  for (const n of notes) {
    const name = n.patient?.trim()
    if (!name) continue
    const norm = name.toLowerCase()
    if (!noteNameByNorm[norm]) noteNameByNorm[norm] = name
  }

  // Build gender lookup from profiles
  const genderByNorm: Record<string, PatientProfile['gender']> = {}
  for (const p of Object.values(profiles)) {
    genderByNorm[p.displayName.trim().toLowerCase()] = p.gender
  }

  return Array.from(map.entries())
    .map(([norm, { count, lastVisit }]) => ({
      name: profilesByNorm[norm] ?? noteNameByNorm[norm] ?? norm,
      count,
      lastVisit,
      gender: genderByNorm[norm],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export default function HistoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()

  const [notes, setNotes] = useState<Note[]>([])
  const [profiles, setProfiles] = useState<Record<string, PatientProfile>>({})
  const [loading, setLoading] = useState(true)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null) // null = All
  const [showNoteList, setShowNoteList] = useState(false) // mobile: toggle panel

  // Read ?patient= URL param on load
  useEffect(() => {
    const param = searchParams.get('patient')
    if (param) { setSelectedPatient(param); setShowNoteList(true) }
  }, [searchParams])

  useEffect(() => {
    if (!user) return
    Promise.all([listNotes(user.uid), getPatientProfiles(user.uid)])
      .then(([n, p]) => { setNotes(n); setProfiles(p) })
      .finally(() => setLoading(false))
  }, [user])

  const patients = useMemo(() => buildPatientList(notes, profiles), [notes, profiles])

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase()
    return q ? patients.filter(p => p.name.toLowerCase().includes(q)) : patients
  }, [patients, patientSearch])

  const visibleNotes = useMemo(() => {
    if (!selectedPatient) return notes
    const norm = selectedPatient.trim().toLowerCase()
    return notes.filter(n => n.patient?.trim().toLowerCase() === norm)
  }, [notes, selectedPatient])

  function handleOpenNote(noteId: string) {
    router.push(`/edit?noteId=${noteId}`)
  }

  function selectPatient(name: string | null) {
    setSelectedPatient(name)
    setShowNoteList(true)
  }

  const patientPanel = (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-header pb-2 shrink-0">
        <input
          type="search"
          value={patientSearch}
          onChange={e => setPatientSearch(e.target.value)}
          placeholder="Search patients…"
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto pb-tabbar">
        {/* All patients row */}
        <button
          onClick={() => selectPatient(null)}
          className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors
            ${!selectedPatient
              ? 'bg-[var(--blue-lt)] text-[var(--blue)]'
              : 'text-[var(--text)] hover:bg-[var(--bg)]'}`}
        >
          <div className="w-7 h-7 rounded-full bg-[var(--bg)] border border-[var(--border)]
                          flex items-center justify-center shrink-0">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">All patients</p>
            <p className="text-xs text-[var(--text3)]">{notes.length} notes</p>
          </div>
        </button>

        {loading
          ? [0, 1, 2, 3].map(i => <PatientRowSkeleton key={i} />)
          : filteredPatients.length === 0
          ? (
            <p className="px-3 py-4 text-xs text-[var(--text3)]">
              {patientSearch ? 'No patients match your search.' : 'No patients yet.'}
            </p>
          )
          : filteredPatients.map(p => {
              const active = selectedPatient?.trim().toLowerCase() === p.name.trim().toLowerCase()
              return (
                <button
                  key={p.name}
                  onClick={() => selectPatient(p.name)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors
                    ${active ? 'bg-[var(--blue-lt)]' : 'hover:bg-[var(--bg)]'}`}
                >
                  <div className="shrink-0">
                    <GenderAvatar gender={p.gender} size={28} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${active ? 'text-[var(--blue)]' : 'text-[var(--text)]'}`}>
                      {p.name}
                    </p>
                    <p className="text-xs text-[var(--text3)]">
                      {p.count} note{p.count !== 1 ? 's' : ''}
                      {p.lastVisit ? ` · ${p.lastVisit}` : ''}
                    </p>
                  </div>
                </button>
              )
            })}
      </div>
    </div>
  )

  const notePanel = (
    <div className="flex flex-col h-full">
      {/* Mobile back button */}
      <div className="sm:hidden px-4 pt-header pb-2 shrink-0 flex items-center gap-2">
        <button
          onClick={() => setShowNoteList(false)}
          className="flex items-center gap-1.5 text-sm text-[var(--blue)]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <polyline points="15,18 9,12 15,6"/>
          </svg>
          Patients
        </button>
        {selectedPatient && (
          <span className="text-sm font-medium text-[var(--text)] truncate">{selectedPatient}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 sm:pt-header pb-tabbar">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => <NoteCardSkeleton key={i} />)}
          </div>
        ) : visibleNotes.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-center">
            <p className="text-sm text-[var(--text3)]">
              {notes.length === 0
                ? 'No notes yet. Generate your first note from the Generate tab.'
                : selectedPatient
                ? `No notes found for ${selectedPatient}.`
                : 'No notes found.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleNotes.map(note => {
              const preview = note.summary?.trim().slice(0, 100) || note.content?.trim().slice(0, 100) || ''
              return (
                <li key={note.id}>
                  <button
                    onClick={() => handleOpenNote(note.id!)}
                    className="w-full text-left rounded-[var(--r)] border border-[var(--border)] bg-white
                               p-3 hover:border-[var(--blue)]/40 hover:shadow-sm active:scale-[0.99]
                               transition-all"
                    style={{ boxShadow: 'var(--shadow-sm)' }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {note.date && (
                          <span className="text-xs font-semibold text-[var(--text)]">{note.date}</span>
                        )}
                        {note.time && (
                          <span className="text-xs text-[var(--text3)]">{note.time}</span>
                        )}
                      </div>
                      {note.clinician && (
                        <span className="text-xs text-[var(--text3)] shrink-0 truncate max-w-[120px]">
                          {note.clinician}
                        </span>
                      )}
                    </div>
                    {!selectedPatient && note.patient && (
                      <p className="text-xs font-medium text-[var(--blue)] mb-1 truncate">{note.patient}</p>
                    )}
                    {preview && (
                      <p className="text-xs text-[var(--text2)] line-clamp-2">{preview}</p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )

  return (
    <div className="h-full overflow-hidden">
      {/* Desktop: two-panel layout */}
      <div className="hidden sm:grid sm:grid-cols-[220px_1fr] h-full">
        <div className="border-r border-[var(--border)] overflow-hidden">
          {patientPanel}
        </div>
        <div className="overflow-hidden">
          {notePanel}
        </div>
      </div>

      {/* Mobile: single panel at a time */}
      <div className="sm:hidden h-full">
        {showNoteList ? notePanel : patientPanel}
      </div>
    </div>
  )
}
