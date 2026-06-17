'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { getPatientProfiles } from '@/lib/firestore/patients'
import { listNotes, deleteNote, renamePatientInNotes } from '@/lib/firestore/notes'
import { GenderAvatar } from '@/components/ui/GenderAvatar'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import PatientModal from '@/components/modals/PatientModal'
import type { Note, PatientProfile } from '@/types'

interface PatientGroup {
  name: string
  reg: string
  visits: number
  lastDate: string
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say' | null
  dob?: string
}

function parseDateStr(s: string): Date | null {
  const parts = s.split('/')
  if (parts.length !== 3) return null
  const d = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const y = parseInt(parts[2], 10)
  if (!d || !m || !y || y < 1900) return null
  return new Date(y, m - 1, d)
}

function formatDateDD(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}/${m}/${date.getFullYear()}`
}

function compareDateStrs(a: string, b: string): number {
  const da = parseDateStr(a)
  const db = parseDateStr(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return da.getTime() - db.getTime()
}

interface SessionCardProps {
  note: Note
  isLatest: boolean
  onClick: () => void
  onDelete: () => void
}

function SessionCard({ note, isLatest, onClick, onDelete }: SessionCardProps) {
  const snippet = (note.content || note.summary || note.presentation || '').slice(0, 120)
  return (
    <div
      onClick={onClick}
      className="bg-white border border-[var(--border)] rounded-[var(--r)] px-4 py-3
                 flex items-center gap-3 cursor-pointer hover:border-[var(--blue)] transition-colors"
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,.05)' }}
    >
      <div className="shrink-0 text-center min-w-[72px]">
        <p className="text-sm font-bold text-[var(--text)]">{note.date || '—'}</p>
        {note.time && <p className="text-xs text-[var(--text3)] mt-0.5">{note.time}</p>}
      </div>
      <div className="flex-1 min-w-0 border-l border-[var(--border)] pl-3">
        <p className="text-sm font-semibold text-[var(--text)] truncate">Progress Note</p>
        {snippet && <p className="text-xs text-[var(--text2)] mt-0.5 line-clamp-2">{snippet}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isLatest
          ? <span className="text-xs border border-[#10b981] text-[#10b981] px-2 py-0.5 rounded-full font-medium">Latest</span>
          : <span className="text-xs border border-[var(--border)] text-[var(--text3)] px-2 py-0.5 rounded-full">Past</span>
        }
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-xs bg-[var(--danger)] text-white px-3 py-1.5 rounded-[var(--r-sm)]
                     font-medium hover:bg-red-700 active:scale-95 transition-all"
          aria-label="Delete session"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

interface PatientDetailProps {
  patient: PatientGroup
  profile?: PatientProfile
  notes: Note[]
  onBack: () => void
  onLoadNote: (noteId: string) => void
  onDeleteNote: (noteId: string) => void
  onEditPatient: () => void
}

function PatientDetail({ patient, profile, notes, onBack, onLoadNote, onDeleteNote, onEditPatient }: PatientDetailProps) {
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null)

  const sortedNotes = useMemo(() =>
    [...notes].sort((a, b) => compareDateStrs(b.date, a.date)),
    [notes]
  )
  const firstDate = sortedNotes[sortedNotes.length - 1]?.date || ''
  const lastDate = sortedNotes[0]?.date || ''
  const clinician = sortedNotes[0]?.clinician || ''

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg)]">

      {/* Back button — right-aligned */}
      <div
        className="shrink-0 px-4 py-2 border-b border-[var(--border)] flex items-center justify-end"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-[var(--blue)] active:scale-95 transition-transform"
        >
          All Patients
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <polyline points="9,18 15,12 9,6"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 space-y-4">

        {/* Patient info card */}
        <div
          className="bg-white border border-[var(--border)] rounded-[var(--r-lg)] p-4 relative"
          style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}
        >
          <button
            onClick={onEditPatient}
            className="absolute top-4 right-4 text-xs border border-[var(--blue)] text-[var(--blue)]
                       px-3 py-1 rounded-[var(--r-sm)] font-medium hover:bg-[var(--blue-lt)] active:scale-95 transition-all"
          >
            Edit
          </button>

          <div className="flex items-start gap-3 mb-4 pr-16">
            <GenderAvatar gender={patient.gender} size={56} />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[var(--text)] truncate">{patient.name}</h2>
              {patient.reg && (
                <p className="text-sm text-[var(--text3)] mt-0.5">Registration #{patient.reg}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <p className="text-xs text-[var(--text3)] mb-0.5">Registration #</p>
              <p className="text-sm font-semibold text-[var(--text)]">{patient.reg || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text3)] mb-0.5">First seen</p>
              <p className="text-sm font-semibold text-[var(--text)]">{firstDate || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text3)] mb-0.5">Last visit</p>
              <p className="text-sm font-semibold text-[var(--text)]">{lastDate || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text3)] mb-0.5">Clinician</p>
              <p className="text-sm font-semibold text-[var(--text)] truncate">{clinician || '—'}</p>
            </div>
          </div>
        </div>

        {/* Sessions section */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-[var(--text3)] uppercase tracking-wider">Sessions</span>
          <span className="text-xs text-[var(--text3)]">{notes.length} visit{notes.length !== 1 ? 's' : ''}</span>
        </div>

        {sortedNotes.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-center">
            <p className="text-sm text-[var(--text3)]">No session notes for this patient.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedNotes.map((note, i) => (
              <SessionCard
                key={note.id}
                note={note}
                isLatest={i === 0}
                onClick={() => note.id && onLoadNote(note.id)}
                onDelete={() => note.id && setDeleteNoteId(note.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* In-app delete confirmation */}
      <Modal open={!!deleteNoteId} onClose={() => setDeleteNoteId(null)} title="Delete Session" maxWidth="sm">
        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-[var(--text2)]">Delete this session permanently? This cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setDeleteNoteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { onDeleteNote(deleteNoteId!); setDeleteNoteId(null) }}>Delete</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default function PatientsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const store = useNoteStore()

  const [notes, setNotes] = useState<Note[]>([])
  const [profiles, setProfiles] = useState<Record<string, PatientProfile>>({})
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'recent' | 'az' | 'visits'>('recent')
  const [quickFilter, setQuickFilter] = useState<'today' | 'week' | 'month' | null>(null)
  const [search, setSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientGroup | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<PatientProfile | undefined>(undefined)

  useEffect(() => {
    if (!user) return
    Promise.all([listNotes(user.uid), getPatientProfiles(user.uid)])
      .then(([n, p]) => { setNotes(n); setProfiles(p) })
      .finally(() => setLoading(false))
  }, [user?.uid])

  const groupedPatients = useMemo<PatientGroup[]>(() => {
    const map = new Map<string, PatientGroup>()

    for (const n of notes) {
      if (!n.patient?.trim()) continue
      const key = n.patient.trim().toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.visits++
        if (compareDateStrs(n.date, existing.lastDate) > 0) existing.lastDate = n.date
        if (!existing.reg && n.reg_number) existing.reg = n.reg_number
      } else {
        map.set(key, { name: n.patient.trim(), reg: n.reg_number || '', visits: 1, lastDate: n.date || '' })
      }
    }

    for (const p of Object.values(profiles)) {
      const key = p.displayName.trim().toLowerCase()
      const existing = map.get(key)
      if (existing) {
        if (!existing.gender) existing.gender = p.gender
        if (!existing.dob) existing.dob = p.dob
      } else {
        map.set(key, { name: p.displayName, reg: '', visits: 0, lastDate: '', gender: p.gender, dob: p.dob })
      }
    }

    return Array.from(map.values())
  }, [notes, profiles])

  const filteredPatients = useMemo<PatientGroup[]>(() => {
    let list = [...groupedPatients]

    if (search) {
      list = list.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    }

    const today = new Date()
    if (quickFilter === 'today') {
      const todayStr = formatDateDD(today)
      list = list.filter(p => p.lastDate === todayStr)
    } else if (quickFilter === 'week') {
      const weekAgo = new Date(today.getTime() - 7 * 86400000)
      list = list.filter(p => { const d = parseDateStr(p.lastDate); return d ? d >= weekAgo : false })
    } else if (quickFilter === 'month') {
      const monthAgo = new Date(today.getTime() - 30 * 86400000)
      list = list.filter(p => { const d = parseDateStr(p.lastDate); return d ? d >= monthAgo : false })
    }

    if (sortBy === 'recent') list.sort((a, b) => compareDateStrs(b.lastDate, a.lastDate))
    else if (sortBy === 'az') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'visits') list.sort((a, b) => b.visits - a.visits)

    return list
  }, [groupedPatients, search, sortBy, quickFilter])

  function loadNote(note: Note) {
    store.setCurrentNoteId(note.id ?? null)
    store.setCurrentNote({
      patient: note.patient, reg_number: note.reg_number, date: note.date,
      time: note.time, clinician: note.clinician, session_number: note.session_number,
      attendance: note.attendance, diagnosis: note.diagnosis, presentation: note.presentation,
      history: note.history, medications: note.medications, mse: note.mse,
      content: note.content, scales: note.scales, risk: note.risk,
      referrals: note.referrals, summary: note.summary, nextsteps: note.nextsteps,
    })
    store.setLastTranscript(note.transcript ?? null)
    store.setLastTranscriptMode(note.transcriptMode || 'paste')
    router.push('/edit')
  }

  function handleLoadNote(noteId: string) {
    const note = notes.find(n => n.id === noteId)
    if (note) loadNote(note)
  }

  async function handleDeleteNote(noteId: string) {
    await deleteNote(noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
  }

  const patientNotes = useMemo(
    () => selectedPatient
      ? notes.filter(n => n.patient?.trim().toLowerCase() === selectedPatient.name.toLowerCase())
      : [],
    [notes, selectedPatient]
  )

  // Find the stored profile for the selected patient
  const selectedProfile = useMemo(() => {
    if (!selectedPatient) return undefined
    return Object.values(profiles).find(
      p => p.displayName.trim().toLowerCase() === selectedPatient.name.toLowerCase()
    )
  }, [selectedPatient, profiles])

  function handleEditPatient() {
    setEditingProfile(selectedProfile ?? {
      displayName: selectedPatient?.name ?? '',
      dob: selectedPatient?.dob,
      gender: selectedPatient?.gender ?? undefined,
    })
  }

  if (selectedPatient) {
    return (
      <div className="h-full overflow-hidden">
        <PatientDetail
          patient={selectedPatient}
          profile={selectedProfile}
          notes={patientNotes}
          onBack={() => setSelectedPatient(null)}
          onLoadNote={handleLoadNote}
          onDeleteNote={handleDeleteNote}
          onEditPatient={handleEditPatient}
        />
        <PatientModal
          open={!!editingProfile}
          patient={editingProfile}
          onSave={async saved => {
            if (saved.id) setProfiles(prev => ({ ...prev, [saved.id!]: saved }))
            const oldName = editingProfile?.displayName?.trim() ?? ''
            const newName = saved.displayName.trim()
            if (oldName && newName && oldName.toLowerCase() !== newName.toLowerCase()) {
              const toRename = notes.filter(n => n.patient?.trim().toLowerCase() === oldName.toLowerCase()).map(n => n.id!)
              if (toRename.length) {
                await renamePatientInNotes(toRename, newName)
                setNotes(prev => prev.map(n =>
                  n.patient?.trim().toLowerCase() === oldName.toLowerCase() ? { ...n, patient: newName } : n
                ))
              }
            }
            setSelectedPatient(prev => prev
              ? { ...prev, name: newName || prev.name, gender: saved.gender, dob: saved.dob }
              : prev
            )
            setEditingProfile(undefined)
          }}
          onClose={() => setEditingProfile(undefined)}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Filter bar */}
      <div
        className="shrink-0 border-b border-[var(--border)] px-4 py-3 space-y-2"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex gap-2">
          {(['recent', 'az', 'visits'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors
                ${sortBy === s
                  ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                  : 'border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)]'}`}
            >
              {s === 'recent' ? 'Recent' : s === 'az' ? 'A–Z' : 'Most Visits'}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['today', 'week', 'month'] as const).map(f => (
            <button
              key={f}
              onClick={() => setQuickFilter(quickFilter === f ? null : f)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors
                ${quickFilter === f
                  ? 'bg-[var(--blue-lt)] text-[var(--blue)] border-[var(--blue)]'
                  : 'border-[var(--border)] text-[var(--text3)] hover:border-[var(--blue)]'}`}
            >
              {f === 'today' ? 'Today' : f === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search patients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2
                     focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     bg-white transition-colors"
        />
      </div>

      {/* Patient list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-0">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[var(--bg)] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-[var(--bg)] rounded w-2/5" />
                  <div className="h-3 bg-[var(--bg)] rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredPatients.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-center px-4">
            <p className="text-sm text-[var(--text3)]">
              {search || quickFilter ? 'No patients match your filters.' : 'No patients yet.'}
            </p>
          </div>
        ) : (
          filteredPatients.map(p => (
            <div
              key={p.name}
              onClick={() => setSelectedPatient(p)}
              className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]
                         hover:bg-[var(--bg)] cursor-pointer transition-colors"
            >
              <GenderAvatar gender={p.gender} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text)] truncate">{p.name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-[var(--text3)]">
                    {p.visits} visit{p.visits !== 1 ? 's' : ''}
                  </span>
                  {p.reg && (
                    <>
                      <span className="text-xs text-[var(--text3)]">·</span>
                      <span className="text-xs text-[var(--text3)]">#{p.reg}</span>
                    </>
                  )}
                  {p.lastDate && (
                    <>
                      <span className="text-xs text-[var(--text3)]">·</span>
                      <span className="text-xs text-[var(--text3)]">Last: {p.lastDate}</span>
                    </>
                  )}
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" className="text-[var(--text3)] shrink-0" aria-hidden>
                <polyline points="9,18 15,12 9,6"/>
              </svg>
            </div>
          ))
        )}
      </div>

      <button
        onClick={() => setAddModalOpen(true)}
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-[#10b981] text-white
                   flex items-center justify-center
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
        open={addModalOpen}
        patient={undefined}
        onSave={saved => {
          if (saved.id) setProfiles(prev => ({ ...prev, [saved.id!]: saved }))
          setAddModalOpen(false)
        }}
        onClose={() => setAddModalOpen(false)}
      />
    </div>
  )
}
