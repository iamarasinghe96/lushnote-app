'use client'

import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { LETTER_TYPE_LABEL, notePatientDob, buildPatientInfoText, isTrackedPatient, TRACKED_CLINICAL_FIELDS, formatDob, calculateAgeFromDOB, patientOtherTopics, PATIENT_FLAGS, patientFlagStyle, appendPatientHistory, patientHistoryGroups } from '@/lib/utils'
import { getPatientProfiles, deletePatientProfile, savePatientProfile } from '@/lib/firestore/patients'
import { updateProfile } from '@/lib/firestore/profiles'
import { listNotes, deleteNote, renamePatientInNotes } from '@/lib/firestore/notes'
import { getTranscriptDraft } from '@/lib/firestore/transcriptDrafts'
import { getHospitalFormsForWorkplace } from '@/lib/firestore/hospitalForms'
import { GenderAvatar } from '@/components/ui/GenderAvatar'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import PatientModal from '@/components/modals/PatientModal'
import AddPatientModal from '@/components/modals/AddPatientModal'
import PatientTable from '@/components/patients/PatientTable'
import LetterPickerModal from '@/components/modals/LetterPickerModal'
import TemplatePicker from '@/components/modals/TemplatePicker'
import { formDataFromPatient } from '@/components/hospital-form/HospitalFormView'
import type { Note, PatientProfile, LetterType, CustomLetterTemplate, AnyTemplate, NoteLength, HospitalFormDoc } from '@/types'

interface PatientGroup {
  // Identity key: a plain name normally, or `name|dob` when the same name has
  // records with conflicting DOBs (so two same-named patients stay separate).
  key: string
  name: string
  reg: string
  visits: number
  lastDate: string
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say' | null
  dob?: string
  // True when another patient shares this name — the DOB is shown to tell them apart.
  ambiguous?: boolean
  // Unified recency (epoch ms) for the Recent sort: newest note date OR the
  // tracked profile's last-change/added time, whichever is later. Lets a
  // freshly-added or freshly-generated patient (even with no dated note) rise.
  recencyTs: number
  flag?: number
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

// Compact age badge shown beside a patient's name, e.g. "29Y". Null when the
// DOB is missing or unparseable, so nothing is rendered.
function ageLabel(dob?: string): string | null {
  const age = calculateAgeFromDOB((dob ?? '').trim())
  return age === null || age < 0 ? null : `${age}Y`
}

function formatDateDD(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}/${m}/${date.getFullYear()}`
}

function compareDateStrs(a: string, b: string): number {
  const da = parseDateStr(a)
  const db = parseDateStr(b)
  // A missing/unparseable date sorts as the OLDEST, never the newest. Otherwise
  // a dateless note (e.g. one left behind by a failed generation) would make its
  // patient's lastDate empty and pin them to the top of the Recent sort, and
  // would win the "Latest" session badge over a real dated note.
  if (!da && !db) return 0
  if (!da) return -1
  if (!db) return 1
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
  const isLetter = note.docType === 'letter'
  const isForm = note.docType === 'hospital-form'
  const title = isLetter ? (note.letterType ? LETTER_TYPE_LABEL[note.letterType] : 'Letter')
    : isForm ? 'Hospital Form' : 'Progress Note'
  const badge = isLetter ? 'Letter' : isForm ? 'Form' : null
  return (
    <div
      onClick={onClick}
      className="bg-white border border-[var(--border)] rounded-[var(--r)] px-4 py-3
                 flex items-center gap-3 cursor-pointer hover:border-[var(--blue)] transition-colors"
      style={{ boxShadow: '0 1px 3px rgba(15,23,42,.05)' }}
    >
      <div className="shrink-0 text-center min-w-[72px]">
        <p className="text-sm font-bold text-[var(--text)]">{note.date || '-'}</p>
        {note.time && <p className="text-xs text-[var(--text3)] mt-0.5">{note.time}</p>}
      </div>
      <div className="flex-1 min-w-0 border-l border-[var(--border)] pl-3">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-[var(--text)] truncate">{title}</p>
          {badge && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--blue)]
                             bg-[var(--blue-lt)] border border-[var(--blue)]/30 rounded-full px-1.5 py-0.5 shrink-0">
              {badge}
            </span>
          )}
        </div>
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

// The patient name, marquee-scrolled when it's too long to fit its box (so a long
// name is fully readable instead of being clipped under the action buttons). The
// scroll only runs when the text actually overflows, and the global
// prefers-reduced-motion rule disables the animation.
function MarqueeName({ name, className }: { name: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current, t = textRef.current
      if (!w || !t) return
      const over = t.scrollWidth - w.clientWidth
      setShift(over > 4 ? over : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [name])

  const duration = Math.max(6, Math.min(18, shift / 16 + 6))
  const style: CSSProperties = shift > 0
    ? { ...({ '--ln-marquee-shift': `-${shift}px` } as CSSProperties), animationDuration: `${duration}s` }
    : {}

  return (
    <div ref={wrapRef} className="overflow-hidden">
      <span
        ref={textRef}
        className={`inline-block whitespace-nowrap ${shift > 0 ? 'ln-name-marquee' : ''} ${className ?? ''}`}
        style={style}
      >
        {name}
      </span>
    </div>
  )
}

// Outlook-style flag: filled for the coloured priorities, outline for the
// lowest, and a faint outline when nothing is set.
function FlagIcon({ flag, size = 16 }: { flag?: number; size?: number }) {
  const style = patientFlagStyle(flag)
  const color = style?.color ?? '#cbd5e1'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden
         fill={style?.filled ? color : 'none'} stroke={color}
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
    </svg>
  )
}

function CheckMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}

// The profile a listed patient belongs to. Reading and writing MUST agree on
// this, or a saved flag lands on a record the row never reads back.
function findProfileForGroup(profiles: Record<string, PatientProfile>, g: PatientGroup): PatientProfile | undefined {
  const nm = g.name.trim().toLowerCase()
  return Object.values(profiles).find(p => {
    if (p.displayName.trim().toLowerCase() !== nm) return false
    // For a name shared by two patients, only the DOB-matching profile is theirs.
    if (g.ambiguous && g.dob) return (p.dob || '').trim() === g.dob
    return true
  })
}

// Editable fields shown on the expandable card section (mirrors the Table view).
const CARD_FIELDS: { key: keyof PatientProfile; label: string }[] = [
  { key: 'urNumber', label: 'UR number' },
  { key: 'status', label: 'Status' },
  ...TRACKED_CLINICAL_FIELDS.map(f => ({ key: f.key, label: f.label })),
  { key: 'otherTopics' as keyof PatientProfile, label: 'Other topics' },
]

interface PatientDetailProps {
  patient: PatientGroup
  profile?: PatientProfile
  editableProfile: PatientProfile
  notes: Note[]
  clinicianName?: string
  flag?: number
  onSetFlag: (flag: 0 | 1 | 2 | 3 | 4) => void
  /** Open the details section immediately (arriving from a flow that just filled it). */
  initialExpanded?: boolean
  onBack: () => void
  onLoadNote: (noteId: string) => void
  onDeleteNote: (noteId: string) => void
  onEditPatient: () => void
  onDeletePatient: () => void
  onGenerate: () => void
  onSaveFields: (patch: Partial<PatientProfile>) => void
}

function PatientDetail({ patient, profile, editableProfile, notes, clinicianName, flag, onSetFlag, initialExpanded, onBack, onLoadNote, onDeleteNote, onEditPatient, onDeletePatient, onGenerate, onSaveFields }: PatientDetailProps) {
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null)
  const [confirmDeletePatient, setConfirmDeletePatient] = useState(false)
  const [expanded, setExpanded] = useState(!!initialExpanded)
  const [flagOpen, setFlagOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Local edit overlay for the expandable fields (mirrors the Table view): keeps
  // typing responsive and debounces the save.
  const [draft, setDraft] = useState<Partial<PatientProfile>>({})
  const pendingRef = useRef<Partial<PatientProfile>>({})
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function fieldValue(key: keyof PatientProfile): string {
    if (key in draft) return String(draft[key] ?? '')
    if (key === 'otherTopics') return patientOtherTopics(editableProfile)
    const v = editableProfile[key]
    return typeof v === 'string' ? v : ''
  }
  function flushFields() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const patch = pendingRef.current
    if (patch && Object.keys(patch).length) { onSaveFields(patch); pendingRef.current = {} }
  }
  function editField(key: keyof PatientProfile, value: string) {
    setDraft(prev => ({ ...prev, [key]: value }))
    pendingRef.current = { ...pendingRef.current, [key]: value }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(flushFields, 800)
  }
  useEffect(() => () => flushFields(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const sortedNotes = useMemo(() =>
    [...notes].sort((a, b) => compareDateStrs(b.date, a.date)),
    [notes]
  )
  // Registration number is the UR number for a tracked patient. First seen = the
  // date the patient was added (profile.createdAt); Last visit = the last change
  // to their data (profile.updatedAt) — falling back to note dates for patients
  // that only exist as notes.
  const reg = profile?.urNumber || patient.reg
  const headerAge = ageLabel(fieldValue('dob') || patient.dob)
  const historyGroups = useMemo(() => patientHistoryGroups(editableProfile), [editableProfile])
  const firstDate = profile?.createdAt ? formatDateDD(new Date(profile.createdAt)) : (sortedNotes[sortedNotes.length - 1]?.date || '')
  const lastDate = profile?.updatedAt ? formatDateDD(new Date(profile.updatedAt)) : (sortedNotes[0]?.date || '')
  const clinician = sortedNotes[0]?.clinician || clinicianName || ''

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg)]">

      {/* Back button - right-aligned */}
      <div
        className="shrink-0 px-4 pb-2 pt-header border-b border-[var(--border)] flex items-center justify-end"
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

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-4 pb-tabbar space-y-4">

        {/* Patient info card */}
        <div
          className="bg-white border border-[var(--border)] rounded-[var(--r-lg)] p-4"
          style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}
        >
          {/* The name line carries the name and age and nothing else — the flag
              and the action buttons sit on their own row beneath, so a long
              name has the full card width before it has to truncate. */}
          <div className="mb-4">
            <div className="flex items-start gap-3 min-w-0">
              <GenderAvatar gender={patient.gender} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <div className="min-w-0 flex-1">
                    <MarqueeName name={patient.name} className="text-xl font-bold text-[var(--text)]" />
                  </div>
                  {headerAge && (
                    <span className="text-base font-semibold text-[var(--text3)] shrink-0">({headerAge})</span>
                  )}
                </div>
                {reg && (
                  <p className="text-sm text-[var(--text3)] mt-0.5">Registration #{reg}</p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="relative shrink-0">
                <button
                  onClick={() => setFlagOpen(o => !o)}
                  aria-label="Set priority flag"
                  title={patientFlagStyle(flag)?.label ?? 'Set priority flag'}
                  className="w-7 h-7 rounded-full flex items-center justify-center
                             hover:bg-[var(--bg)] active:scale-95 transition-all"
                >
                  <FlagIcon flag={flag} />
                </button>
                {flagOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setFlagOpen(false)} aria-hidden />
                    <div
                      className="absolute left-0 top-8 z-20 w-44 rounded-[var(--r)] border border-[var(--border)] bg-white overflow-hidden py-1"
                      style={{ boxShadow: '0 8px 24px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.04)' }}
                    >
                      {PATIENT_FLAGS.map(f => (
                        <button
                          key={f.value}
                          onClick={() => { onSetFlag(f.value); setFlagOpen(false) }}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
                            ${flag === f.value ? 'bg-[var(--blue-lt)] font-semibold text-[var(--blue)]' : 'text-[var(--text)] hover:bg-[var(--bg)]'}`}
                        >
                          <FlagIcon flag={f.value} />
                          <span className="flex-1">{f.label}</span>
                          {flag === f.value && <CheckMark />}
                        </button>
                      ))}
                      <div className="h-px bg-[var(--border)] my-1" />
                      <button
                        onClick={() => { onSetFlag(0); setFlagOpen(false) }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
                          ${!flag ? 'bg-[var(--blue-lt)] font-semibold text-[var(--blue)]' : 'text-[var(--text2)] hover:bg-[var(--bg)]'}`}
                      >
                        <FlagIcon />
                        <span className="flex-1">No flag</span>
                        {!flag && <CheckMark />}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="flex-1" />
              <button
                onClick={onEditPatient}
                className="text-xs border border-[var(--blue)] text-[var(--blue)]
                           px-3 py-1.5 rounded-[var(--r-sm)] font-medium hover:bg-[var(--blue-lt)] active:scale-95 transition-all"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmDeletePatient(true)}
                className="text-xs border border-[var(--danger)] text-[var(--danger)]
                           px-3 py-1.5 rounded-[var(--r-sm)] font-medium hover:bg-red-50 active:scale-95 transition-all"
              >
                Delete
              </button>
              <button
                onClick={onGenerate}
                className="text-xs bg-[#10b981] text-white
                           px-3.5 py-1.5 rounded-[var(--r-sm)] font-medium hover:bg-[#059669] active:scale-95 transition-all"
              >
                Generate
              </button>
            </div>
          </div>

          <button
            onClick={() => { if (expanded) flushFields(); setExpanded(e => !e) }}
            className="mt-4 w-full flex items-center justify-center gap-1.5 border border-[var(--border)]
                       text-[var(--text2)] py-2 rounded-[var(--r)] text-sm font-medium
                       hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-[0.99] transition-all"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide patient details' : 'Show & edit all patient details'}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className={`transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {expanded && (
            <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <p className="text-xs text-[var(--text3)] mb-0.5">Registration #</p>
                  <p className="text-sm font-semibold text-[var(--text)]">{reg || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text3)] mb-0.5">First seen</p>
                  <p className="text-sm font-semibold text-[var(--text)]">{firstDate || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text3)] mb-0.5">Last visit</p>
                  <p className="text-sm font-semibold text-[var(--text)]">{lastDate || '-'}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[var(--text3)] mb-0.5">Clinician</p>
                  <p className="text-sm font-semibold text-[var(--text)] overflow-x-auto whitespace-nowrap scrollbar-none">{clinician || '-'}</p>
                </div>
              </div>
              {/* Grey inset (bleeds to the card edges) so the white edit boxes pop,
                  matching the note editor. */}
              <div className="-mx-4 -mb-4 mt-1 px-4 py-4 bg-[var(--bg)] border-t border-[var(--border)] rounded-b-[var(--r-lg)] space-y-3">
                {CARD_FIELDS.map(f => {
                  const numeric = f.key === 'urNumber' || f.key === 'dob'
                  return (
                    <Textarea
                      key={f.key as string}
                      label={f.label}
                      autoResize
                      rows={1}
                      value={fieldValue(f.key)}
                      onChange={e => editField(f.key, f.key === 'dob' ? formatDob(e.target.value) : e.target.value)}
                      onBlur={flushFields}
                      inputMode={numeric ? 'numeric' : undefined}
                      autoCapitalize={numeric ? 'none' : 'sentences'}
                      maxLength={f.key === 'dob' ? 10 : 6000}
                      className="appearance-none !bg-white"
                    />
                  )
                })}

                {/* Read-only trail of how each field has changed. Collapsed by
                    default — an active patient's trail is long, and it sits
                    between the details and the sessions list. */}
                {historyGroups.length > 0 && (
                  <div className="pt-3 mt-1 border-t border-[var(--border)]">
                    <button
                      onClick={() => setHistoryOpen(o => !o)}
                      aria-expanded={historyOpen}
                      className="mx-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full
                                 text-xs font-medium text-[var(--text2)] border border-[var(--border)] bg-white
                                 hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-95 transition-all"
                    >
                      Editing history
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg)] text-[var(--text3)]">
                        {historyGroups.length}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                           className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`} aria-hidden>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </button>

                    {historyOpen && (
                      <div className="mt-3 space-y-3">
                        {historyGroups.map(g => (
                          <div key={g.key}>
                            <p className="text-xs font-medium text-[var(--text2)] mb-1">{g.label}</p>
                            <p className="text-xs text-[var(--text)] leading-relaxed">
                              {g.entries.map((e, i) => (
                                <span key={i}>
                                  {i > 0 && <span className="text-[var(--text3)] mx-1">→</span>}
                                  <span className="text-[var(--text3)]">{formatDateDD(new Date(e.at))}: </span>
                                  {e.value}
                                </span>
                              ))}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
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

      {/* In-app delete session confirmation */}
      <Modal open={!!deleteNoteId} onClose={() => setDeleteNoteId(null)} title="Delete Session" maxWidth="sm">
        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-[var(--text2)]">Delete this session permanently? This cannot be undone.</p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setDeleteNoteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { onDeleteNote(deleteNoteId!); setDeleteNoteId(null) }}>Delete</Button>
          </div>
        </div>
      </Modal>

      {/* In-app delete patient confirmation */}
      <Modal open={confirmDeletePatient} onClose={() => setConfirmDeletePatient(false)} title="Delete Patient" maxWidth="sm">
        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-[var(--text2)]">
            Permanently delete <strong>{patient.name}</strong> and all their data? This cannot be undone.
            {notes.length > 0 && (
              <span className="block mt-1 text-[var(--danger)]">
                {notes.length} session note{notes.length !== 1 ? 's' : ''} will also be deleted.
              </span>
            )}
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConfirmDeletePatient(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => { setConfirmDeletePatient(false); onDeletePatient() }}>Delete</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default function PatientsPage() {
  const router = useRouter()
  const { user, profile, refreshProfile } = useAuth()
  const store = useNoteStore()

  const [notes, setNotes] = useState<Note[]>([])
  const [profiles, setProfiles] = useState<Record<string, PatientProfile>>({})
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'recent' | 'az' | 'visits' | 'custom' | 'flag'>('recent')
  // The sort to return to when "Flagged first" is switched off, so it's a
  // temporary lens over whatever the doctor actually prefers.
  const prevSortRef = useRef<'recent' | 'az' | 'visits' | 'custom'>('recent')
  // The doctor's saved arrangement (PatientGroup keys, top first) and whether
  // they're currently rearranging.
  const [order, setOrder] = useState<string[]>([])
  const [reordering, setReordering] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flagMenu, setFlagMenu] = useState<{ key: string; x: number; y: number } | null>(null)
  const sortInitRef = useRef(false)
  const [quickFilter, setQuickFilter] = useState<'today' | 'week' | 'month' | null>(null)
  const [search, setSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientGroup | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<PatientProfile | undefined>(undefined)
  const [unfinishedDraft, setUnfinishedDraft] = useState<{ text: string; durationSec: number } | null>(null)
  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() => {
    // ?view=table lands straight on the table — used after filling a patient's
    // record from a pasted note, so the doctor sees the fields that landed.
    if (typeof window === 'undefined') return 'cards'
    return new URLSearchParams(window.location.search).get('view') === 'table' ? 'table' : 'cards'
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  // The patient a document is being generated for (opens the letter/note picker).
  const [generateFor, setGenerateFor] = useState<PatientProfile | null>(null)
  const [genTemplateOpen, setGenTemplateOpen] = useState(false)
  const [tableDeleteTarget, setTableDeleteTarget] = useState<PatientProfile | null>(null)
  const [hospitalForms, setHospitalForms] = useState<HospitalFormDoc[]>([])

  useEffect(() => {
    if (!user) return
    Promise.all([listNotes(user.uid), getPatientProfiles(user.uid)])
      .then(([n, p]) => { setNotes(n); setProfiles(p) })
      .finally(() => setLoading(false))
    getTranscriptDraft(user.uid).then(d => {
      setUnfinishedDraft(d && typeof d.text === 'string' && d.text.trim().length > 0
        ? { text: d.text, durationSec: d.durationSec ?? 0 }
        : null)
    }).catch(() => {})
  }, [user?.uid])

  // A saved arrangement takes precedence over Recent, so adopt it (once) as soon
  // as the profile loads. Guarded by a ref so it never fights a sort the doctor
  // picks afterwards.
  useEffect(() => {
    if (sortInitRef.current || !profile) return
    sortInitRef.current = true
    const saved = profile.patientOrder ?? []
    if (saved.length) { setOrder(saved); setSortBy('custom'); prevSortRef.current = 'custom' }
  }, [profile])

  useEffect(() => {
    if (!flagMenu) return
    const close = () => setFlagMenu(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [flagMenu])

  // Hospital forms available to the active workplace (campus-gated), so the
  // patient card offers the same set as the Generate tab.
  useEffect(() => {
    if (!profile) { setHospitalForms([]); return }
    const activeWp = profile.workplaces?.find(w => w.id === profile.activeWorkplaceId)
    if (!activeWp?.name) { setHospitalForms([]); return }
    getHospitalFormsForWorkplace(activeWp.name).then(setHospitalForms).catch(() => setHospitalForms([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.activeWorkplaceId, profile?.workplaces])

  // Tapping the Patients tab while already on it doesn't navigate (same
  // route), so it can't reset a drilled-into patient by itself. The tab bar
  // broadcasts a reselect event in that case — use it to back out to the list.
  useEffect(() => {
    function onReselect(e: Event) {
      const detail = (e as CustomEvent<{ href: string }>).detail
      if (detail?.href === '/patients') setSelectedPatient(null)
    }
    window.addEventListener('tabbar-reselect', onReselect)
    return () => window.removeEventListener('tabbar-reselect', onReselect)
  }, [])

  // A name is "split" only when its records carry 2+ distinct DOBs — i.e. two
  // different people share the name. Everyone else groups by name exactly as
  // before (no behaviour change for normal data).
  const splitNames = useMemo(() => {
    const dobsByName = new Map<string, Set<string>>()
    for (const n of notes) {
      const nm = n.patient?.trim().toLowerCase()
      if (!nm) continue
      const d = notePatientDob(n)
      if (!d) continue
      if (!dobsByName.has(nm)) dobsByName.set(nm, new Set())
      dobsByName.get(nm)!.add(d)
    }
    const split = new Set<string>()
    dobsByName.forEach((set, nm) => { if (set.size >= 2) split.add(nm) })
    return split
  }, [notes])

  // The group a record belongs to: `name|dob` for a split name, else just `name`.
  const groupKeyFor = useCallback((n: Pick<Note, 'patient' | 'docType' | 'letterData'>) => {
    const nm = (n.patient ?? '').trim().toLowerCase()
    return splitNames.has(nm) ? `${nm}|${notePatientDob(n)}` : nm
  }, [splitNames])

  const groupedPatients = useMemo<PatientGroup[]>(() => {
    const map = new Map<string, PatientGroup>()
    const tsOfDate = (s: string) => { const d = parseDateStr(s); return d ? d.getTime() : 0 }

    for (const n of notes) {
      if (!n.patient?.trim()) continue
      const nm = n.patient.trim().toLowerCase()
      const key = groupKeyFor(n)
      const dob = notePatientDob(n)
      const existing = map.get(key)
      if (existing) {
        existing.visits++
        if (compareDateStrs(n.date, existing.lastDate) > 0) existing.lastDate = n.date
        existing.recencyTs = Math.max(existing.recencyTs, tsOfDate(n.date))
        if (!existing.reg && n.reg_number) existing.reg = n.reg_number
        if (!existing.dob && dob) existing.dob = dob
      } else {
        map.set(key, { key, name: n.patient.trim(), reg: n.reg_number || '', visits: 1, lastDate: n.date || '', dob: dob || undefined, ambiguous: splitNames.has(nm), recencyTs: tsOfDate(n.date) })
      }
    }

    for (const p of Object.values(profiles)) {
      const nm = p.displayName.trim().toLowerCase()
      const profTs = Math.max(p.updatedAt ?? 0, p.createdAt ?? 0)
      const regFromUr = (p.urNumber ?? '').trim()
      if (splitNames.has(nm)) {
        // Attach a name-keyed profile's gender to the DOB-matching subgroup only;
        // never spawn a phantom group for an ambiguous name.
        const existing = map.get(`${nm}|${(p.dob || '').trim()}`)
        if (existing) {
          if (!existing.gender) existing.gender = p.gender
          if (regFromUr) existing.reg = regFromUr
          existing.recencyTs = Math.max(existing.recencyTs, profTs)
        }
      } else {
        const existing = map.get(nm)
        if (existing) {
          if (!existing.gender) existing.gender = p.gender
          if (!existing.dob) existing.dob = p.dob
          if (regFromUr) existing.reg = regFromUr   // Registration # is the UR number
          existing.recencyTs = Math.max(existing.recencyTs, profTs)
        } else {
          map.set(nm, { key: nm, name: p.displayName, reg: regFromUr, visits: 0, lastDate: '', gender: p.gender, dob: p.dob, recencyTs: profTs })
        }
      }
    }

    const groups = Array.from(map.values())
    // Flags resolved last, through the same lookup the save uses.
    for (const g of groups) g.flag = findProfileForGroup(profiles, g)?.flag
    return groups
  }, [notes, profiles, groupKeyFor, splitNames])

  // Deep-link into a patient's overview from the AI Assistant. The FAB dispatches
  // 'ln-open-patient' (caught if this page is already mounted) and navigates to
  // ?patient=<name> (read once here on a fresh mount, after notes have grouped).
  const deepLinkConsumedRef = useRef(false)
  const [expandOnOpen, setExpandOnOpen] = useState(false)
  // Arriving via ?patient= means we're heading straight into one patient's card.
  // Rendering the list meanwhile would flash it for a beat before swapping, so
  // hold a quiet loading screen until the card is ready.
  const [deepLinkPending, setDeepLinkPending] = useState(
    () => typeof window !== 'undefined' && !!new URLSearchParams(window.location.search).get('patient')
  )
  useEffect(() => {
    function selectByName(name: string) {
      const q = name.trim().toLowerCase()
      const target = groupedPatients.find(p => p.name.trim().toLowerCase() === q)
      if (target) setSelectedPatient(target)
    }
    function onOpenPatient(e: Event) {
      const name = (e as CustomEvent<{ name: string }>).detail?.name
      if (name) selectByName(name)
    }
    window.addEventListener('ln-open-patient', onOpenPatient)
    if (!deepLinkConsumedRef.current && groupedPatients.length) {
      const params = new URLSearchParams(window.location.search)
      const name = params.get('patient')
      if (name) {
        deepLinkConsumedRef.current = true
        if (params.get('expand') === '1') setExpandOnOpen(true)
        selectByName(name)
      }
      // Batched with the selection above, so the card is on screen the same
      // frame the loading screen goes away.
      setDeepLinkPending(false)
    }
    return () => window.removeEventListener('ln-open-patient', onOpenPatient)
  }, [groupedPatients])

  useEffect(() => {
    if (!loading && deepLinkPending && groupedPatients.length === 0) setDeepLinkPending(false)
  }, [loading, deepLinkPending, groupedPatients.length])

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

    if (sortBy === 'flag') {
      const rank = new Map(order.map((k, i) => [k, i]))
      // Unflagged sorts last; ties fall back to the saved arrangement (or
      // recency), so flagging never discards the doctor's ordering.
      const within = (a: PatientGroup, b: PatientGroup) => {
        const ra = rank.get(a.key), rb = rank.get(b.key)
        if (ra !== undefined && rb !== undefined) return ra - rb
        if (ra !== undefined) return -1
        if (rb !== undefined) return 1
        return b.recencyTs - a.recencyTs
      }
      list.sort((a, b) => ((a.flag || 9) - (b.flag || 9)) || within(a, b))
    }
    else if (sortBy === 'custom') {
      const rank = new Map(order.map((k, i) => [k, i]))
      list.sort((a, b) => {
        const ra = rank.get(a.key), rb = rank.get(b.key)
        // Patients added since the arrangement was saved aren't ranked — keep
        // them below it, most recent first, rather than dropping them anywhere.
        if (ra === undefined && rb === undefined) return (b.recencyTs - a.recencyTs)
        if (ra === undefined) return 1
        if (rb === undefined) return -1
        return ra - rb
      })
    }
    else if (sortBy === 'recent') list.sort((a, b) => (b.recencyTs - a.recencyTs) || compareDateStrs(b.lastDate, a.lastDate))
    else if (sortBy === 'az') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'visits') list.sort((a, b) => b.visits - a.visits)

    return list
  }, [groupedPatients, search, sortBy, quickFilter, order])

  function loadNote(note: Note) {
    // Clear any hospital form the edit page is currently showing so opening a note
    // or letter doesn't get stuck on the previous form (the edit page early-returns
    // the form editor whenever store.hospitalForm is set). The form path below
    // re-loads its own form via ?noteId, so this reset is safe for it too.
    store.resetHospitalForm()
    // A saved letter re-opens in the letter editor. Route via ?noteId so the edit
    // page owns hydration (and primes its "already saved" guard so merely opening
    // the letter doesn't re-write it). Don't touch letter state here — resetting it
    // would wipe the fields when the store already holds this letter.
    if (note.docType === 'letter' && note.id) {
      router.push('/edit?noteId=' + note.id)
      return
    }
    if (note.docType === 'hospital-form' && note.id) {
      router.push('/edit?noteId=' + note.id)
      return
    }
    store.resetLetterMode()
    store.setCurrentNoteId(note.id ?? null)
    store.setCurrentNote({
      patient: note.patient, reg_number: note.reg_number, date: note.date,
      time: note.time, clinician: note.clinician, session_number: note.session_number,
      attendance: note.attendance, diagnosis: note.diagnosis, presentation: note.presentation,
      history: note.history, medications: note.medications, mse: note.mse,
      content: note.content, scales: note.scales, risk: note.risk,
      referrals: note.referrals, summary: note.summary, nextsteps: note.nextsteps,
      extraSections: note.extraSections,
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
      ? notes.filter(n => groupKeyFor(n) === selectedPatient.key)
      : [],
    [notes, selectedPatient, groupKeyFor]
  )

  // Derive first-seen date from sorted patient notes
  const patientFirstSeen = useMemo(() => {
    if (!patientNotes.length) return ''
    const sorted = [...patientNotes].sort((a, b) => compareDateStrs(a.date, b.date))
    return sorted[0]?.date || ''
  }, [patientNotes])
  const selectedProfile = useMemo(() => {
    if (!selectedPatient) return undefined
    const nm = selectedPatient.name.trim().toLowerCase()
    return Object.values(profiles).find(p => {
      if (p.displayName.trim().toLowerCase() !== nm) return false
      // For an ambiguous (same-name) patient, only the DOB-matching profile is theirs.
      if (selectedPatient.ambiguous && selectedPatient.dob) return (p.dob || '').trim() === selectedPatient.dob
      return true
    })
  }, [selectedPatient, profiles])

  function handleEditPatient() {
    setEditingProfile(selectedProfile ?? {
      displayName: selectedPatient?.name ?? '',
      dob: selectedPatient?.dob,
      gender: selectedPatient?.gender ?? undefined,
    })
  }

  // Tracked patients (dictated via Add Patient, or given a UR / clinical fields)
  // are the Table view's rows, most-recently-edited first.
  const trackedProfiles = useMemo(
    () => Object.values(profiles)
      .filter(isTrackedPatient)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.displayName.localeCompare(b.displayName)),
    [profiles]
  )

  // Rearranging works on the full list, so clear any search/filter first —
  // otherwise moving a row "up" inside a filtered view would jump it an
  // unpredictable distance in the real order. Seed the arrangement from what's
  // on screen now so every patient has a defined position.
  function startReorder() {
    setSearch('')
    setQuickFilter(null)
    // Seed from EVERY patient, not the on-screen list. Clearing the filters above
    // doesn't refresh the memoised filteredPatients within this handler, so
    // seeding from it would silently drop whoever the filters were hiding.
    // Existing arrangement first, then anyone unranked by recency.
    const rank = new Map(order.map((k, i) => [k, i]))
    const all = [...groupedPatients].sort((a, b) => {
      const ra = rank.get(a.key), rb = rank.get(b.key)
      if (ra === undefined && rb === undefined) return b.recencyTs - a.recencyTs
      if (ra === undefined) return 1
      if (rb === undefined) return -1
      return ra - rb
    })
    setOrder(all.map(p => p.key))
    setSortBy('custom')
    setReordering(true)
  }

  function movePatient(key: string, dir: -1 | 1) {
    setOrder(prev => {
      const next = prev.includes(key) ? [...prev] : [...prev, key]
      const i = next.indexOf(key)
      const j = i + dir
      if (i < 0 || j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function movePatientToTop(key: string) {
    setOrder(prev => [key, ...prev.filter(k => k !== key)])
  }

  function movePatientToBottom(key: string) {
    setOrder(prev => [...prev.filter(k => k !== key), key])
  }

  async function saveOrder() {
    if (!user) return
    setSavingOrder(true)
    try {
      await updateProfile(user.uid, { patientOrder: order })
      await refreshProfile()
      prevSortRef.current = 'custom'
      setReordering(false)
    } catch {
      setError('Could not save the order. Check your connection and try again.')
    } finally {
      setSavingOrder(false)
    }
  }

  // Drop the arrangement and go back to most-recent-first.
  async function clearOrder() {
    if (!user) return
    setSavingOrder(true)
    try {
      await updateProfile(user.uid, { patientOrder: [] })
      await refreshProfile()
      setOrder([])
      setSortBy('recent')
      setReordering(false)
    } catch {
      setError('Could not clear the order. Check your connection and try again.')
    } finally {
      setSavingOrder(false)
    }
  }

  // Flags live on the patient profile, so a patient who only exists as notes gets
  // one created the first time they're flagged. Saved straight away — 0 clears it
  // (rather than undefined, which the client Firestore instance would drop,
  // leaving the old flag in place).
  async function setPatientFlag(g: PatientGroup, flag: 0 | 1 | 2 | 3 | 4) {
    setFlagMenu(null)
    if (!user) return
    const existing = findProfileForGroup(profiles, g)
    const now = Date.now()
    const merged: PatientProfile = {
      ...(existing ?? {
        displayName: g.name,
        ...(g.reg ? { urNumber: g.reg } : {}),
        ...(g.dob ? { dob: g.dob } : {}),
        ...(g.gender ? { gender: g.gender } : {}),
      }),
      flag,
      updatedAt: now,
      createdAt: existing?.createdAt ?? now,
    }
    try {
      const id = await savePatientProfile(user.uid, merged)
      setProfiles(prev => ({ ...prev, [id]: { ...merged, id } }))
    } catch {
      setError('Could not save the flag. Check your connection and try again.')
    }
  }

  function todayStr() {
    const t = new Date()
    return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`
  }

  // A Table-view cell edit: merge the patch, persist, and reflect it locally.
  async function handleTableSave(id: string, patch: Partial<PatientProfile>) {
    if (!user) return
    const existing = profiles[id]
    if (!existing) return
    const history = appendPatientHistory(existing, patch)
    const merged: PatientProfile = { ...existing, ...patch, ...(history ? { history } : {}), updatedAt: Date.now() }
    setProfiles(prev => ({ ...prev, [id]: merged }))
    try { await savePatientProfile(user.uid, merged) } catch { /* kept in state; retried on next edit */ }
  }

  // Generating a document is a change to the patient — bump updatedAt so they
  // rise to the top of Recent (and "Last visit" reflects it), even before the
  // new note's date is saved.
  function bumpProfileUpdated(p: PatientProfile) {
    if (!user || !p.id) return
    const existing = profiles[p.id]
    if (!existing) return
    const merged: PatientProfile = { ...existing, updatedAt: Date.now() }
    setProfiles(prev => ({ ...prev, [p.id!]: merged }))
    savePatientProfile(user.uid, merged).catch(() => {})
  }

  // Generate a letter from a tracked patient's stored fields: assemble them into a
  // synthetic transcript and hand off to the edit page's letter generator — the
  // same path a dictated letter takes.
  function startLetterFromPatient(p: PatientProfile, type: LetterType, customTemplate?: CustomLetterTemplate | null) {
    setGenerateFor(null)
    bumpProfileUpdated(p)
    store.resetHospitalForm()
    store.resetLetterMode()
    store.setCurrentNoteId(null)
    store.setLastTranscript(buildPatientInfoText(p))
    store.setLastTranscriptMode('document')
    const effectiveType: LetterType = type === 'custom' && !customTemplate ? 'freetext' : type
    store.setLetterType(effectiveType)
    if (effectiveType === 'custom' && customTemplate) {
      store.setCustomLetterTemplate(customTemplate)
      store.setCustomLetterSections(customTemplate.sections.map(s => ({ key: s.key, heading: s.heading, content: '' })))
    }
    store.setLetterCommonFields({ letterDate: todayStr(), patientName: p.displayName, dob: p.dob ?? '' })
    store.setLetterForKnownPatient(true)   // it's this patient's own card — no duplicate-name warning
    store.setPendingLetterGeneration(true)
    router.push('/edit')
  }

  // Fill a hospital form from the patient's stored fields. Same shape as the
  // letter path: the record becomes the "transcript" and the form's own AI pass
  // pulls the identifiers and writes the entry.
  function startHospitalFormFromPatient(p: PatientProfile, form: HospitalFormDoc) {
    setGenerateFor(null)
    bumpProfileUpdated(p)
    store.resetLetterMode()
    store.resetHospitalForm()
    store.setCurrentNoteId(null)
    store.setHospitalForm(form)
    store.setHospitalFormData(formDataFromPatient(form.formKey, p))
    // A hospital form documents THIS entry, not the patient's accumulated
    // record — feeding the whole record in turned a four-line ward round into a
    // 13-page form. Falls back to the record for patients with no stored entry.
    store.setLastTranscript(p.entries?.[0]?.text?.trim() || p.lastEntry?.trim() || buildPatientInfoText(p))
    store.setLastTranscriptMode('document')
    store.setPendingHospitalFormGeneration(true)
    router.push('/edit')
  }

  // Generate a clinical note from a tracked patient's stored fields: assemble them
  // as the transcript and run standard note generation with the chosen template.
  // Clinician defaults to the logged-in doctor's name.
  function startClinicalNoteFromPatient(p: PatientProfile, template: AnyTemplate, noteLength: NoteLength) {
    setGenTemplateOpen(false)
    setGenerateFor(null)
    bumpProfileUpdated(p)
    store.resetHospitalForm()
    store.resetLetterMode()
    store.setCurrentNote({ patient: p.displayName, reg_number: p.urNumber ?? '', clinician: profile?.displayName ?? '' })
    store.setCurrentNoteId(null)
    store.setLastTranscript(buildPatientInfoText(p))
    store.setLastTranscriptMode('document')
    store.setLastChosenTemplate(template)
    store.setOverrideNoteLength(noteLength)
    store.setPendingAnimation(true)
    router.push('/edit')
  }

  async function confirmDeleteTracked() {
    const p = tableDeleteTarget
    setTableDeleteTarget(null)
    if (!p || !user) return
    const nm = p.displayName.trim().toLowerCase()
    const noteIds = notes.filter(n => n.id && (n.patient ?? '').trim().toLowerCase() === nm).map(n => n.id!)
    await Promise.all(noteIds.map(id => deleteNote(id))).catch(() => {})
    if (noteIds.length) setNotes(prev => prev.filter(n => !(n.id && noteIds.includes(n.id!))))
    if (p.id) {
      await deletePatientProfile(user.uid, p.id).catch(() => {})
      setProfiles(prev => { const next = { ...prev }; delete next[p.id!]; return next })
    }
  }

  // Editing the expandable fields on a patient's card writes to their profile,
  // creating one lazily for a note-only patient. A ref holds the profile id for
  // the current patient so rapid edits update one doc instead of creating many.
  const editProfileIdRef = useRef<string | null>(null)
  useEffect(() => { editProfileIdRef.current = selectedProfile?.id ?? null }, [selectedPatient?.key, selectedProfile?.id])

  async function handleSaveSelectedFields(patch: Partial<PatientProfile>) {
    if (!user || !selectedPatient) return
    const existingId = editProfileIdRef.current
    const base: PatientProfile = existingId && profiles[existingId]
      ? profiles[existingId]
      : {
          displayName: selectedPatient.name,
          ...(selectedPatient.reg ? { urNumber: selectedPatient.reg } : {}),
          ...(selectedPatient.dob ? { dob: selectedPatient.dob } : {}),
          ...(selectedPatient.gender ? { gender: selectedPatient.gender } : {}),
        }
    const now = Date.now()
    const history = appendPatientHistory(base, patch, now)
    const merged: PatientProfile = {
      ...base, ...patch, ...(history ? { history } : {}), tracked: true, updatedAt: now,
      createdAt: (existingId && profiles[existingId]?.createdAt) || base.createdAt || now,
      ...(existingId ? { id: existingId } : {}),
    }
    try {
      const id = await savePatientProfile(user.uid, merged)
      editProfileIdRef.current = id
      setProfiles(prev => ({ ...prev, [id]: { ...merged, id } }))
    } catch { /* kept in the card's draft; retried on the next edit */ }
  }

  // The letter/note picker for the per-patient "Generate" button. Rendered in both
  // the list/table view and the drilled-in detail view (which returns early).
  function renderGenerateFlow() {
    const p = generateFor
    return (
      <>
        <LetterPickerModal
          open={!!p && !genTemplateOpen}
          onSelect={type => p && startLetterFromPatient(p, type)}
          onSelectClinicalNote={() => setGenTemplateOpen(true)}
          onClose={() => setGenerateFor(null)}
          customTemplates={profile?.customLetterTemplates ?? []}
          onSelectCustom={t => p && startLetterFromPatient(p, 'custom', t)}
          hospitalForms={hospitalForms}
          onSelectHospitalForm={form => p && startHospitalFormFromPatient(p, form)}
        />
        <TemplatePicker
          open={!!p && genTemplateOpen}
          onSelect={(template, noteLength) => p && startClinicalNoteFromPatient(p, template, noteLength)}
          onCancel={() => setGenTemplateOpen(false)}
        />
      </>
    )
  }

  if (deepLinkPending && !selectedPatient) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 bg-[var(--bg)]">
        <svg width="26" height="26" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)]" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
        </svg>
        <p className="text-sm text-[var(--text3)]">Opening patient…</p>
      </div>
    )
  }

  if (selectedPatient) {
    return (
      <div className="h-full overflow-hidden">
        <PatientDetail
          patient={selectedPatient}
          profile={selectedProfile}
          editableProfile={selectedProfile ?? {
            displayName: selectedPatient.name,
            ...(selectedPatient.reg ? { urNumber: selectedPatient.reg } : {}),
            ...(selectedPatient.dob ? { dob: selectedPatient.dob } : {}),
            ...(selectedPatient.gender ? { gender: selectedPatient.gender } : {}),
          }}
          notes={patientNotes}
          clinicianName={profile?.displayName}
          flag={selectedProfile?.flag ?? selectedPatient.flag}
          onSetFlag={f => setPatientFlag(selectedPatient, f)}
          initialExpanded={expandOnOpen}
          onBack={() => setSelectedPatient(null)}
          onLoadNote={handleLoadNote}
          onDeleteNote={handleDeleteNote}
          onEditPatient={handleEditPatient}
          onSaveFields={handleSaveSelectedFields}
          onGenerate={() => setGenerateFor(selectedProfile ?? {
            displayName: selectedPatient.name,
            ...(selectedPatient.reg ? { urNumber: selectedPatient.reg } : {}),
            ...(selectedPatient.dob ? { dob: selectedPatient.dob } : {}),
          })}
          onDeletePatient={async () => {
            // Delete all session notes for this patient
            await Promise.all(patientNotes.filter(n => n.id).map(n => deleteNote(n.id!)))
            setNotes(prev => prev.filter(n => groupKeyFor(n) !== selectedPatient.key))
            // Delete the patient profile if one exists
            if (selectedProfile?.id && user) {
              await deletePatientProfile(user.uid, selectedProfile.id)
              setProfiles(prev => {
                const next = { ...prev }
                delete next[selectedProfile.id!]
                return next
              })
            }
            setSelectedPatient(null)
          }}
        />
        <PatientModal
          open={!!editingProfile}
          patient={editingProfile}
          regNumber={selectedPatient.reg || undefined}
          firstSeen={patientFirstSeen || undefined}
          onSave={async saved => {
            if (saved.id) setProfiles(prev => ({ ...prev, [saved.id!]: saved }))
            const oldName = editingProfile?.displayName?.trim() ?? ''
            const newName = saved.displayName.trim()
            const renamed = !!(oldName && newName && oldName.toLowerCase() !== newName.toLowerCase())
            if (renamed) {
              // Rename only THIS patient's records (the selected group), so renaming
              // one of two same-named patients never touches the other.
              const toRename = notes.filter(n => n.id && groupKeyFor(n) === selectedPatient.key).map(n => n.id!)
              if (toRename.length) {
                await renamePatientInNotes(toRename, newName)
                const renameSet = new Set(toRename)
                setNotes(prev => prev.map(n => (n.id && renameSet.has(n.id)) ? { ...n, patient: newName } : n))
              }
            }
            setSelectedPatient(prev => {
              if (!prev) return prev
              const finalName = newName || prev.name
              // After a rename the collision is resolved, so the record keys under a
              // plain name; keep the existing key otherwise.
              return { ...prev, name: finalName, key: renamed ? finalName.trim().toLowerCase() : prev.key, gender: saved.gender, dob: saved.dob }
            })
            setEditingProfile(undefined)
          }}
          onClose={() => setEditingProfile(undefined)}
        />
        {renderGenerateFlow()}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: view toggle + Add Patient (always visible) */}
      <div
        className="shrink-0 border-b border-[var(--border)] px-4 pb-3 pt-header space-y-2"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
            className={`relative flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium
              active:scale-95 transition-all shrink-0
              ${filtersOpen ? 'border-[var(--blue)] text-[var(--blue)] bg-[var(--blue-lt)]' : 'border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)]'}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/>
            </svg>
            Filters
            {(sortBy !== 'recent' || quickFilter || viewMode === 'table') && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#10b981] ring-2 ring-white" aria-hidden />
            )}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`} aria-hidden>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-1.5 text-xs bg-[var(--blue)] text-white
                       px-3 py-1.5 rounded-full font-medium hover:bg-[var(--blue-dk)]
                       active:scale-95 transition-all shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Patient
          </button>
        </div>

        {/* Full-width filter panel: collapses to zero height when closed (no
            reserved space); chips wrap across the whole width when open. */}
        <div className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 ease-out
          ${filtersOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden min-h-0">
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="inline-flex rounded-full border border-[var(--border)] p-0.5 bg-white shrink-0">
                {(['cards', 'table'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`text-xs px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap
                      ${viewMode === v ? 'bg-[#10b981] text-white' : 'text-[var(--text2)] hover:text-[var(--blue)]'}`}
                  >
                    {v === 'cards' ? 'Cards' : 'Table view'}
                  </button>
                ))}
              </div>
              {viewMode === 'cards' && (
                <>
                  <span className="hidden sm:block w-px h-4 bg-[var(--border)] mx-0.5" aria-hidden />
                  {(['recent', 'az', 'visits'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors whitespace-nowrap
                        ${sortBy === s
                          ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                          : 'border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)]'}`}
                    >
                      {s === 'recent' ? 'Recent' : s === 'az' ? 'A–Z' : 'Most Visits'}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (sortBy === 'flag') setSortBy(prevSortRef.current)
                      else { prevSortRef.current = sortBy as 'recent' | 'az' | 'visits' | 'custom'; setSortBy('flag') }
                    }}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border transition-colors whitespace-nowrap
                      ${sortBy === 'flag'
                        ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                        : 'border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)]'}`}
                  >
                    <FlagIcon flag={sortBy === 'flag' ? undefined : 1} size={12} />
                    Flagged first
                  </button>
                  {order.length > 0 && (
                    <button
                      onClick={() => setSortBy('custom')}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors whitespace-nowrap
                        ${sortBy === 'custom'
                          ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                          : 'border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue)]'}`}
                    >
                      My order
                    </button>
                  )}
                  <span className="hidden sm:block w-px h-4 bg-[var(--border)] mx-0.5" aria-hidden />
                  <button
                    onClick={startReorder}
                    className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border border-[#10b981]/50
                               text-[#059669] font-medium hover:bg-[#10b981]/10 transition-colors whitespace-nowrap"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <polyline points="8 6 12 2 16 6"/><line x1="12" y1="2" x2="12" y2="10"/>
                      <polyline points="16 18 12 22 8 18"/><line x1="12" y1="14" x2="12" y2="22"/>
                    </svg>
                    Rearrange
                  </button>
                  <span className="hidden sm:block w-px h-4 bg-[var(--border)] mx-0.5" aria-hidden />
                  {(['today', 'week', 'month'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setQuickFilter(quickFilter === f ? null : f)}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors whitespace-nowrap
                        ${quickFilter === f
                          ? 'bg-[var(--blue-lt)] text-[var(--blue)] border-[var(--blue)]'
                          : 'border-[var(--border)] text-[var(--text3)] hover:border-[var(--blue)]'}`}
                    >
                      {f === 'today' ? 'Today' : f === 'week' ? 'This Week' : 'This Month'}
                    </button>
                  ))}

                </>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-[var(--r)] bg-red-50 border border-red-200 px-3 py-2 text-xs text-[var(--danger)] flex items-start justify-between gap-2">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="underline shrink-0">Dismiss</button>
          </div>
        )}

        {reordering && (
          <div className="rounded-[var(--r)] bg-[#10b981]/10 border border-[#10b981]/40 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-[#059669] font-medium">
              Arrange your list with the arrows, then save. This order replaces “Recent”.
            </p>
            <div className="flex gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={clearOrder} disabled={savingOrder}>Reset</Button>
              <Button variant="primary" size="sm" onClick={saveOrder} loading={savingOrder}>Save order</Button>
            </div>
          </div>
        )}

        {/* Search stays visible (a primary action, not tucked under Filters).
            Hidden while rearranging — moves apply to the full list. */}
        {viewMode === 'cards' && !reordering && (
          <input
            type="text"
            placeholder="Search patients..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2
                       focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       bg-white transition-colors"
          />
        )}
      </div>

      {/* Table view */}
      {viewMode === 'table' ? (
        <PatientTable
          profiles={trackedProfiles}
          onSave={handleTableSave}
          onGenerate={p => setGenerateFor(p)}
          onDelete={p => setTableDeleteTarget(p)}
        />
      ) : (
      /* Patient list (cards) */
      <div className="flex-1 overflow-y-auto scrollbar-none pb-tabbar">
        {/* An interrupted recording that never got a patient name lives only in
            the recovery draft (not in progress_notes, so it can't group like a
            real patient). Surface it here as an "Unnamed patient" row so the
            doctor can find it in the list and tap through to name + generate. */}
        {unfinishedDraft && (
          <div
            onClick={() => router.push('/generate?recover=1')}
            className="flex items-center gap-3 px-4 py-3 border-b border-amber-200 bg-amber-50/60
                       hover:bg-amber-50 cursor-pointer transition-colors"
          >
            <GenderAvatar gender={null} size={40} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-[var(--text)] truncate">Unnamed patient</p>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700
                                 bg-amber-100 border border-amber-300 rounded-full px-1.5 py-0.5 shrink-0">
                  Unfinished
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-[var(--text3)]">
                  ~{unfinishedDraft.text.trim().split(/\s+/).length} words captured
                </span>
                <span className="text-xs text-[var(--text3)]">·</span>
                <span className="text-xs text-amber-700">Tap to name &amp; generate</span>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" className="text-[var(--text3)] shrink-0" aria-hidden>
              <polyline points="9,18 15,12 9,6"/>
            </svg>
          </div>
        )}
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
        ) : filteredPatients.length === 0 && !unfinishedDraft ? (
          <div className="flex items-center justify-center h-40 text-center px-4">
            <p className="text-sm text-[var(--text3)]">
              {search || quickFilter ? 'No patients match your filters.' : 'No patients yet.'}
            </p>
          </div>
        ) : (
          filteredPatients.map(p => (
            <div
              key={p.key}
              onClick={reordering ? undefined : () => setSelectedPatient(p)}
              className={`flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] transition-colors
                ${reordering ? 'bg-white' : 'hover:bg-[var(--bg)] cursor-pointer'}`}
            >
              <GenderAvatar gender={p.gender} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[var(--text)] truncate">{p.name}</p>
                  {ageLabel(p.dob) && (
                    <span className="text-sm font-semibold text-[var(--text3)] shrink-0">({ageLabel(p.dob)})</span>
                  )}
                  {p.ambiguous && p.dob && (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-300 rounded-full px-1.5 py-0.5 shrink-0">
                      DOB {p.dob}
                    </span>
                  )}
                </div>
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
              {/* Priority flag — its own tap target, so it never opens the patient. */}
              {!reordering && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setFlagMenu(prev => prev?.key === p.key ? null : { key: p.key, x: r.right, y: r.bottom + 6 })
                  }}
                  aria-label={`Set priority flag for ${p.name}`}
                  title={patientFlagStyle(p.flag)?.label ?? 'Set priority flag'}
                  className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                             hover:bg-[var(--bg)] active:scale-95 transition-all"
                >
                  <FlagIcon flag={p.flag} />
                </button>
              )}
              {reordering ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => movePatientToTop(p.key)}
                    aria-label={`Move ${p.name} to top`}
                    title="Move to top"
                    className="w-8 h-8 rounded-[var(--r-sm)] border border-[var(--border)] flex items-center justify-center
                               text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-95 transition-all"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <line x1="5" y1="4" x2="19" y2="4"/><polyline points="7 12 12 7 17 12"/><line x1="12" y1="7" x2="12" y2="20"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => movePatient(p.key, -1)}
                    aria-label={`Move ${p.name} up`}
                    className="w-8 h-8 rounded-[var(--r-sm)] border border-[var(--border)] flex items-center justify-center
                               text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-95 transition-all"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <polyline points="6 15 12 9 18 15"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => movePatient(p.key, 1)}
                    aria-label={`Move ${p.name} down`}
                    className="w-8 h-8 rounded-[var(--r-sm)] border border-[var(--border)] flex items-center justify-center
                               text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-95 transition-all"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => movePatientToBottom(p.key)}
                    aria-label={`Move ${p.name} to bottom`}
                    title="Move to bottom"
                    className="w-8 h-8 rounded-[var(--r-sm)] border border-[var(--border)] flex items-center justify-center
                               text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-95 transition-all"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <line x1="12" y1="4" x2="12" y2="17"/><polyline points="7 12 12 17 17 12"/><line x1="5" y1="20" x2="19" y2="20"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" className="text-[var(--text3)] shrink-0" aria-hidden>
                  <polyline points="9,18 15,12 9,6"/>
                </svg>
              )}
            </div>
          ))
        )}
      </div>
      )}

      {flagMenu && (
        <div
          className="fixed z-[80] rounded-[var(--r)] border border-[var(--border)] bg-white overflow-hidden py-1"
          style={{ top: flagMenu.y, left: Math.max(8, flagMenu.x - 176), width: 176,
                   boxShadow: '0 8px 24px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.04)' }}
          onMouseDown={e => e.stopPropagation()}
          onTouchStart={e => e.stopPropagation()}
          role="listbox"
        >
          {PATIENT_FLAGS.map(f => {
            const target = groupedPatients.find(g => g.key === flagMenu.key)
            const current = target?.flag === f.value
            return (
              <button
                key={f.value}
                onClick={() => target && setPatientFlag(target, f.value)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
                  ${current ? 'bg-[var(--blue-lt)] font-semibold text-[var(--blue)]' : 'text-[var(--text)] hover:bg-[var(--bg)]'}`}
              >
                <FlagIcon flag={f.value} />
                <span className="flex-1">{f.label}</span>
                {current && <CheckMark />}
              </button>
            )
          })}
          <div className="h-px bg-[var(--border)] my-1" />
          {(() => {
            const target = groupedPatients.find(g => g.key === flagMenu.key)
            const none = !target?.flag
            return (
              <button
                onClick={() => { if (target) setPatientFlag(target, 0) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
                  ${none ? 'bg-[var(--blue-lt)] font-semibold text-[var(--blue)]' : 'text-[var(--text2)] hover:bg-[var(--bg)]'}`}
              >
                <FlagIcon />
                <span className="flex-1">No flag</span>
                {none && <CheckMark />}
              </button>
            )
          })()}
        </div>
      )}

      <AddPatientModal
        open={addModalOpen}
        onSaved={(saved, warning) => {
          if (saved.id) setProfiles(prev => ({ ...prev, [saved.id!]: saved }))
          setAddModalOpen(false)
          setViewMode('table')
          // Saved, but the AI couldn't fill the clinical fields — say so rather
          // than leaving the doctor to wonder why the row is empty.
          if (warning) setError(warning)
        }}
        onClose={() => setAddModalOpen(false)}
      />

      {renderGenerateFlow()}

      {/* Table-view delete confirmation */}
      <Modal open={!!tableDeleteTarget} onClose={() => setTableDeleteTarget(null)} title="Delete Patient" maxWidth="sm">
        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-[var(--text2)]">
            Permanently delete <strong>{tableDeleteTarget?.displayName}</strong> and all their data? This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setTableDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDeleteTracked}>Delete</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
