'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { openSettings, quotaDate, getGroqKey, getGeminiKey, parsePatientIntakeFields, appendPatientHistory, mergeExtras, formatOtherTopics, pushPatientEntry } from '@/lib/utils'
import { classifyPastedText, resolvePastedKind, type PastedSource } from '@/lib/pastedText'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import RecordModal from '@/components/modals/RecordModal'
import DictateModal from '@/components/modals/DictateModal'
import TranscriptConfirmModal from '@/components/modals/TranscriptConfirmModal'
import ScanNoteModal, { type ScannedPatient } from '@/components/modals/ScanNoteModal'
import TemplatePicker from '@/components/modals/TemplatePicker'
import LetterPickerModal from '@/components/modals/LetterPickerModal'
import CustomLetterBuilderModal from '@/components/modals/CustomLetterBuilderModal'
import { listNotes } from '@/lib/firestore/notes'
import { getTranscriptDraft, deleteTranscriptDraft, saveDraftHandoff } from '@/lib/firestore/transcriptDrafts'
import { EMPTY_HANDOFF, type DraftHandoff } from '@/lib/draftHandoff'
import { buildDictationTemplate } from '@/lib/dictationTemplate'
import { getHospitalFormsForWorkplace, getHospitalForm } from '@/lib/firestore/hospitalForms'
import { updateProfile } from '@/lib/firestore/profiles'
import { getPatientProfiles, savePatientProfile } from '@/lib/firestore/patients'
import type { AnyTemplate, NoteCreationMode, Note, LetterType, CustomLetterTemplate, HospitalFormDoc, PatientProfile } from '@/types'

const GEMINI_RPD = 20

/** Comprehensive Psychology Note. What "Start a psychiatrist note" means. */
const DICTATION_TEMPLATE_ID = '1'

type GenPhase =
  | 'idle'
  | 'paste-choice'
  | 'paste-input'
  | 'scan-input'
  | 'document-input'
  | 'upload-input'
  | 'recording'
  | 'dictating'
  | 'transcribing'
  | 'template-picking'
  | 'generating'

// `requireClinicalWords` guards against generating a note from arbitrary pasted
// text. A photographed progress note needs no such guess — the doctor chose a
// clinical form to scan, and a medical ward entry ("ascites", "hypokalaemia",
// "IDC removal") legitimately contains none of these psychiatry-leaning words.
function validateTranscript(text: string, opts?: { requireClinicalWords?: boolean }): { valid: boolean; error?: string } {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  if (wordCount < 80)
    return { valid: false, error: `Transcript too short (${wordCount} words). Minimum 80 words required.` }
  if (opts?.requireClinicalWords === false) return { valid: true }
  const keywords = [
    'patient', 'symptom', 'diagnosis', 'treatment', 'medication', 'therapy',
    'appointment', 'session', 'presenting', 'mood', 'affect', 'behaviour',
    'behavior', 'cognition', 'anxiety', 'depression',
  ]
  if (!keywords.some(k => text.toLowerCase().includes(k)))
    return { valid: false, error: 'Transcript does not appear to contain clinical content.' }
  return { valid: true }
}

interface ModeCardProps {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}

function ModeCard({ icon, title, description, onClick }: ModeCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-[var(--r-lg)] bg-white border border-[#10b981]/40
                 p-4 flex items-start gap-3 hover:border-[var(--blue)] hover:shadow-md
                 focus:border-[var(--blue)] focus:outline-none
                 active:scale-[0.99] transition-all"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <span className="mt-0.5 text-[var(--blue)] shrink-0">{icon}</span>
      <div>
        <p className="font-semibold text-sm text-[var(--text)]">{title}</p>
        <p className="text-xs text-[var(--text2)] mt-0.5">{description}</p>
      </div>
    </button>
  )
}

const PasteIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="9" y="2" width="6" height="4" rx="1"/>
    <path d="M5 4h-1a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1"/>
    <line x1="9" y1="12" x2="15" y2="12"/>
    <line x1="9" y1="16" x2="15" y2="16"/>
  </svg>
)
const RecordIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)
const DictateIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
  </svg>
)
const DocumentIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14,2 14,8 20,8"/>
    <line x1="9" y1="13" x2="15" y2="13"/>
    <line x1="9" y1="17" x2="15" y2="17"/>
  </svg>
)
const CameraIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
)

const UploadIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <polyline points="16,16 12,12 8,16"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
  </svg>
)


export default function GeneratePage() {
  const router = useRouter()
  const { user, profile, refreshProfile } = useAuth()
  const store = useNoteStore()

  const [phase, setPhase] = useState<GenPhase>('idle')
  const [recoveredDraft, setRecoveredDraft] = useState<{ text: string; letterType: string | null; durationSec: number } | null>(null)
  const [inputText, setInputText] = useState('')
  const [pendingTranscript, setPendingTranscript] = useState('')
  const [creationMode, setCreationMode] = useState<NoteCreationMode>('paste')
  const [error, setError] = useState<string | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [transcriptConfirmOpen, setTranscriptConfirmOpen] = useState(false)
  const [prefillPatient, setPrefillPatient] = useState<{ patient: string; reg_number: string; session_number: string; attendance: string } | null>(null)
  // Patient details read off a scanned ward note's label, used to seed the
  // Confirm transcript step. Null for every other pathway.
  const [scanPrefill, setScanPrefill] = useState<{ patient: string; regNumber: string; dob: string; gender: 'male' | 'female' | '' } | null>(null)
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const [patientProfileList, setPatientProfileList] = useState<PatientProfile[]>([])
  const [letterPickerOpen, setLetterPickerOpen] = useState(false)
  const [patientSaving, setPatientSaving] = useState(false)
  // Whether the naming step matched an EXISTING patient — used to suppress the
  // duplicate-name warning on a letter written for them.
  const existingPatientRef = useRef(false)
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false)
  const [clinicalNoteMode, setClinicalNoteMode] = useState(false)
  const [hospitalForms, setHospitalForms] = useState<HospitalFormDoc[]>([])
  // The captured transcript didn't pass the clinical-content check, but a real
  // recording must never be thrown away — carry it through naming to the edit
  // page and save it there WITHOUT generating (the doctor can generate on
  // demand). Set when we let a non-clinical transcript proceed.
  const skipGenerationRef = useRef(false)
  // Why a pasted transcript isn't suitable for a psychiatry session NOTE (too
  // short / no clinical content). Letters and the patient record have no such
  // requirement, so the paste itself is never blocked — this is only checked if
  // the doctor then picks a clinical note template.
  const noteBlockRef = useRef<string | null>(null)
  // How the pending text arrived. Read once, at the template picker, to decide
  // what the default button does — see resolvePastedKind.
  const pendingSourceRef = useRef<PastedSource>('paste')

  // The only way in. `source` is required rather than defaulted because the
  // default button's behaviour turns on it: a new entry point that forgot to
  // say would silently inherit the last one's source, and the failure — a
  // pasted transcript offering to overwrite a patient record — would not look
  // like a missing argument.
  function beginPendingTranscript(text: string, source: PastedSource) {
    pendingSourceRef.current = source
    setPendingTranscript(text)
  }
  // Accumulates across the two steps that fill it — naming the patient, then
  // picking the template — so the second write does not erase the first.
  const handoffRef = useRef<DraftHandoff>(EMPTY_HANDOFF)

  useEffect(() => {
    if (localStorage.getItem('_ln_rec_interrupted')) {
      setShowBanner(true)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    listNotes(user.uid).then(setAllNotes).catch(() => {})
    getPatientProfiles(user.uid).then(m => setPatientProfileList(Object.values(m))).catch(() => {})
  }, [user?.uid])

  // Hospital forms available to the active workplace (campus-gated). Mirrors the
  // letterhead resolution in the app shell.
  useEffect(() => {
    if (!profile) { setHospitalForms([]); return }
    const activeWp = profile.workplaces?.find(w => w.id === profile.activeWorkplaceId)
    if (!activeWp?.name) { setHospitalForms([]); return }
    getHospitalFormsForWorkplace(activeWp.name).then(setHospitalForms).catch(() => setHospitalForms([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.activeWorkplaceId, profile?.workplaces])

  // Refresh notes when the confirm modal opens so the daily reg counter
  // and patient index reflect anyone registered earlier this session.
  useEffect(() => {
    if (transcriptConfirmOpen && user) {
      listNotes(user.uid).then(setAllNotes).catch(() => {})
      getPatientProfiles(user.uid).then(m => setPatientProfileList(Object.values(m))).catch(() => {})
    }
  }, [transcriptConfirmOpen, user?.uid])

  // Quota calculation (date aligned to Google's Pacific reset)
  const today = quotaDate()
  const usageEntry = profile?.geminiUsage?.['gemini-2.5-flash']
  const usedToday = usageEntry?.date === today ? (usageEntry?.count ?? 0) : 0

  // Groq key availability + session token tracking
  const hasGroqKey = typeof window !== 'undefined' && Boolean(sessionStorage.getItem('groq_api_key'))
  const [groqTokensUsed, setGroqTokensUsed] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    return parseInt(localStorage.getItem('ln_groq_tokens_session') || '0', 10)
  })

  function handleSkipToLetter() {
    setPhase('idle')
    setInputText('')
    setLetterPickerOpen(true)
  }

  function todayStr() {
    const today = new Date()
    return `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`
  }

  function handleLetterTypeSelected(type: LetterType) {
    setLetterPickerOpen(false)
    store.resetHospitalForm()
    store.resetLetterMode()
    store.setCurrentNoteId(null)
    store.setLastTranscript(null)   // manual letter — no dictation to attach
    store.setLetterType(type)
    store.setLetterCommonFields({ letterDate: todayStr() })
    router.push('/edit')
  }

  // Manual (no-dictation) custom letter: seed empty per-topic sections from the
  // template and open the edit page for typing.
  function handleCustomLetterSelected(t: CustomLetterTemplate) {
    setLetterPickerOpen(false)
    store.resetHospitalForm()
    store.resetLetterMode()
    store.setCurrentNoteId(null)
    store.setLastTranscript(null)   // manual letter — no dictation to attach
    store.setLetterType('custom')
    store.setCustomLetterTemplate(t)
    store.setCustomLetterSections(t.sections.map(s => ({ key: s.key, heading: s.heading, content: '' })))
    store.setLetterCommonFields({ letterDate: todayStr() })
    router.push('/edit')
  }

  async function handleSaveCustomTemplate(t: CustomLetterTemplate) {
    setCustomBuilderOpen(false)
    if (!user) return
    const current = profile?.customLetterTemplates ?? []
    const next = current.some(x => x.id === t.id)
      ? current.map(x => x.id === t.id ? t : x)
      : [...current, t]
    await updateProfile(user.uid, { customLetterTemplates: next }).catch(() => {})
    await refreshProfile()
  }

  // Doctor wants to write a consultation note by hand (no dictation/transcript):
  // pick a clinical template, then fill the note fields manually on the edit tab.
  function handleSelectClinicalNote() {
    setLetterPickerOpen(false)
    setClinicalNoteMode(true)
    setPhase('template-picking')
  }

  // Create Document → hospital form = start a BLANK form to type into (the
  // dictation path lives under Dictate Note, like other letters).
  function handleSelectHospitalForm(form: HospitalFormDoc) {
    setLetterPickerOpen(false)
    startHospitalForm(form, undefined)
  }

  // Dictate Note → hospital form: the transcript is ready, generate the form.
  function handleDictatedHospitalForm(text: string, duration: number, form: HospitalFormDoc) {
    store.setLastRecordingDuration(duration)
    store.setLastRecordingEndTime(Date.now())
    if (!text.trim()) { setError('Nothing was transcribed. Please try again.'); return }
    startHospitalForm(form, text)
  }

  function startHospitalForm(form: HospitalFormDoc, transcript?: string) {
    store.resetLetterMode()
    store.resetHospitalForm()
    store.setCurrentNoteId(null)
    store.setHospitalForm(form)
    store.setLastTranscript(transcript ?? null)
    store.setLastTranscriptMode('dictation')
    store.setPendingHospitalFormGeneration(!!transcript)
    // Same reason as the letter path: HospitalFormView deletes the draft once
    // the form is saved. Deleting it here threw away the recording before the
    // form existed to replace it.
    router.push('/edit')
  }

  // A recovered dictation draft tagged 'hospitalform:<key>'. Resolve the form and
  // resume; if the form config is gone, degrade to plain-note naming so the
  // transcript is never lost.
  function recoverHospitalForm(formKey: string, text: string) {
    getHospitalForm(formKey).then(form => {
      if (form) { startHospitalForm(form, text); return }
      skipGenerationRef.current = !validateTranscript(text).valid
      beginPendingTranscript(text, 'paste')
      setTranscriptConfirmOpen(true)
    }).catch(() => {
      skipGenerationRef.current = !validateTranscript(text).valid
      beginPendingTranscript(text, 'paste')
      setTranscriptConfirmOpen(true)
    })
  }

  function startMode(mode: NoteCreationMode) {
    setCreationMode(mode)
    setError(null)
    setInputText('')
    if (mode === 'document') setPhase('document-input')
    else if (mode === 'conversation') setPhase('recording')
    else if (mode === 'dictation') setPhase('dictating')
    else if (mode === 'upload') setPhase('upload-input')
  }

  // The doctor picks how the content arrives — typed/pasted text, or a photo of a
  // paper ward note. Reading the clipboard on their behalf was guesswork: it
  // failed loudly whenever the clipboard held something else.
  function handlePasteMode() {
    setCreationMode('paste')
    setError(null)
    setInputText('')
    setScanPrefill(null)
    setPhase('paste-choice')
  }

  // OCR text takes the same road as a paste: confirm the patient, pick a
  // template, generate. The identifiers read off the label pre-fill the confirm
  // step instead of being typed again.
  function handleScannedNote(text: string, patient: ScannedPatient) {
    const trimmed = text.trim()
    const validation = validateTranscript(trimmed, { requireClinicalWords: false })
    noteBlockRef.current = validation.valid ? null : validation.error!
    skipGenerationRef.current = false
    setCreationMode('paste')
    setScanPrefill({
      patient: patient.name,
      regNumber: patient.urNumber,
      dob: patient.dob,
      gender: patient.gender,
    })
    setPhase('idle')
    beginPendingTranscript(trimmed, 'scan')
    setTranscriptConfirmOpen(true)
  }

  function handleCancel() {
    setPhase('idle')
    setInputText('')
    setPendingTranscript('')
    setError(null)
    setTranscriptConfirmOpen(false)
    setPrefillPatient(null)
    setScanPrefill(null)
  }

  function handleTextConfirm() {
    if (!inputText.trim()) return
    const text = inputText.trim()
    const validation = validateTranscript(text)
    noteBlockRef.current = validation.valid ? null : validation.error!
    skipGenerationRef.current = false
    setInputText('')
    setPhase('idle')
    beginPendingTranscript(text, 'paste')
    setTranscriptConfirmOpen(true)
  }

  // Load any transcript from a recording that was interrupted before it
  // finished, so it can be recovered instead of lost.
  useEffect(() => {
    if (!user) return
    getTranscriptDraft(user.uid).then(d => {
      if (!(d && typeof d.text === 'string' && d.text.trim().length > 0)) return
      const draft = { text: d.text, letterType: d.letterType ?? null, durationSec: d.durationSec ?? 0 }
      setRecoveredDraft(draft)
      // Arriving from the Patients "Unnamed" entry (?recover=1) skips the banner
      // and drops the doctor straight into naming the patient.
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('recover') === '1') {
        recoverDraftIntoNaming(draft)
      }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  // The modals now record and transcribe live in segments and hand us the
  // finished transcript text. All we do here is route it into the note or
  // letter flow.
  async function handleTranscriptReady(text: string, duration: number, letterType?: LetterType | null, customTemplateId?: string) {
    store.setLastRecordingDuration(duration)
    // Capture the wall-clock end of the recording for the auto session End time.
    store.setLastRecordingEndTime(Date.now())
    setPhase('idle')

    if (letterType) {
      if (!text.trim()) {
        setError('Nothing was transcribed. Please try again.')
        return
      }
      const customTemplate = letterType === 'custom' && customTemplateId
        ? (profile?.customLetterTemplates ?? []).find(t => t.id === customTemplateId) ?? null
        : null
      startLetterFromTranscript(text, letterType, customTemplate)
      return
    }

    if (!text.trim()) {
      setError('Nothing was transcribed. Please try again.')
      return
    }
    // A recorded/dictated transcript is never discarded, even if it doesn't look
    // clinical — proceed to naming regardless. When it failed the check, flag it
    // so the edit page saves it without forcing (and wasting quota on) an AI note.
    skipGenerationRef.current = !validateTranscript(text).valid
    noteBlockRef.current = null
    beginPendingTranscript(text, 'paste')
    setTranscriptConfirmOpen(true)
  }

  // `known` carries the patient already confirmed in the naming step (the paste
  // pathway), so their name lands on the letter and the duplicate-name warning
  // — which exists for brand-new letters — stays out of the way.
  function startLetterFromTranscript(
    text: string,
    letterType: LetterType,
    customTemplate?: CustomLetterTemplate | null,
    known?: { patient: string; mode: NoteCreationMode; existingPatient: boolean },
  ) {
    store.resetHospitalForm()
    store.resetLetterMode()
    // Fresh letter → its own new doc; never reuse a note id left in the store.
    store.setCurrentNoteId(null)
    store.setLastTranscript(text)
    store.setLastTranscriptMode(known?.mode ?? 'dictation')
    // A custom letter with no resolvable template (e.g. deleted) degrades to a
    // free-text letter so the dictation is never lost.
    const effectiveType: LetterType = letterType === 'custom' && !customTemplate ? 'freetext' : letterType
    store.setLetterType(effectiveType)
    if (effectiveType === 'custom' && customTemplate) {
      store.setCustomLetterTemplate(customTemplate)
      store.setCustomLetterSections(customTemplate.sections.map(s => ({ key: s.key, heading: s.heading, content: '' })))
    }
    store.setLetterCommonFields({ letterDate: todayStr(), ...(known?.patient ? { patientName: known.patient } : {}) })
    if (known?.existingPatient) store.setLetterForKnownPatient(true)
    store.setPendingLetterGeneration(true)
    // The draft is NOT deleted here. It used to be, which meant the only durable
    // copy of a dictated letter was destroyed at the moment of navigating —
    // before the letter had been generated, let alone saved. A reload in that
    // window lost the whole dictation with nothing left behind, not even the
    // "Unnamed patient" row. doAutoSaveLetter clears it once the letter is
    // actually in Firestore, which is the only point at which it is redundant.
    router.push('/edit')
  }

  // A recovery draft stores a custom letter's type as "custom:<id>". Resolve it
  // back to its template (null if the template was since deleted → freetext).
  function resolveDraftLetter(raw: string): { letterType: LetterType; customTemplate: CustomLetterTemplate | null } {
    if (raw.startsWith('custom:')) {
      const id = raw.slice(7)
      return { letterType: 'custom', customTemplate: (profile?.customLetterTemplates ?? []).find(x => x.id === id) ?? null }
    }
    return { letterType: raw as LetterType, customTemplate: null }
  }

  // Drop a recovered draft into the patient-naming step (TranscriptConfirmModal),
  // or the letter flow if it was a dictated letter. Shared by the banner's "Add
  // patient details" button and the ?recover=1 deep-link from the Patients tab.
  function recoverDraftIntoNaming(d: { text: string; letterType: string | null; durationSec: number }) {
    setRecoveredDraft(null)
    store.setLastRecordingDuration(d.durationSec)
    store.setLastRecordingEndTime(Date.now())
    if (d.letterType && d.letterType.startsWith('hospitalform:')) {
      recoverHospitalForm(d.letterType.slice('hospitalform:'.length), d.text)
      return
    }
    if (d.letterType) {
      const { letterType, customTemplate } = resolveDraftLetter(d.letterType)
      startLetterFromTranscript(d.text, letterType, customTemplate)
      return
    }
    if (!d.text.trim()) {
      setError('Nothing was transcribed. Please try again.')
      return
    }
    // Recovering a draft must always work — never block on the clinical-content
    // check. If it doesn't look clinical, flag it so the edit page keeps the
    // transcript without auto-generating a note from it.
    skipGenerationRef.current = !validateTranscript(d.text).valid
    noteBlockRef.current = null
    beginPendingTranscript(d.text, 'paste')
    setTranscriptConfirmOpen(true)
  }

  function useRecoveredDraft() {
    if (recoveredDraft) recoverDraftIntoNaming(recoveredDraft)
  }

  function discardRecoveredDraft() {
    if (user) deleteTranscriptDraft(user.uid).catch(() => {})
    setRecoveredDraft(null)
  }

  // Generate a note straight from a recovered transcript WITHOUT the patient
  // name/age/gender step. The edit page shows an "incomplete information"
  // warning; the note won't persist until a patient name is entered.
  function generateFromDraftDirect() {
    const d = recoveredDraft
    if (!d) return
    setRecoveredDraft(null)
    store.setLastRecordingDuration(d.durationSec)
    store.setLastRecordingEndTime(Date.now())
    if (d.letterType && d.letterType.startsWith('hospitalform:')) {
      recoverHospitalForm(d.letterType.slice('hospitalform:'.length), d.text)
      return
    }
    if (d.letterType) {
      const { letterType, customTemplate } = resolveDraftLetter(d.letterType)
      startLetterFromTranscript(d.text, letterType, customTemplate)
      return
    }
    store.resetHospitalForm()
    store.setLastTranscript(d.text)
    store.setLastTranscriptMode('conversation')
    store.setPendingPatientProfile(null)
    store.setIncompleteTranscript(true)
    setPrefillPatient(null)
    setCreationMode('conversation')
    // Keep the recovery draft until a note carrying this transcript is durably
    // saved (in the edit page). Deleting it here would lose the session if the
    // tab reloads before the note is persisted.
    setPhase('template-picking')
  }

  function handleTranscriptConfirmPatient(
    patient: string,
    regNumber: string,
    dob: string,
    gender: 'male' | 'female' | '',
    isNewPatient: boolean,
    sessionNumber: string,
    attendance: string,
  ) {
    setTranscriptConfirmOpen(false)
    store.resetHospitalForm()
    existingPatientRef.current = !isNewPatient
    setPrefillPatient({ patient, reg_number: regNumber, session_number: sessionNumber, attendance })
    store.setLastTranscript(pendingTranscript)
    store.setLastTranscriptMode(creationMode)
    store.setPendingPatientProfile(isNewPatient ? { dob, gender } : null)

    // Everything above this line is React state, which a page load discards.
    // Put what the doctor just typed beside the transcript in the recovery
    // draft, so a reload between here and the edit page can hand it back
    // instead of losing the name and resurfacing the session as "Unnamed".
    if (user) {
      handoffRef.current = {
        ...EMPTY_HANDOFF,
        patient, reg_number: regNumber, session_number: sessionNumber, attendance, dob, gender,
      }
      void saveDraftHandoff(user.uid, handoffRef.current)
    }

    // Non-clinical transcript: skip the template picker and generation entirely.
    // Land on the edit page, where it's saved under the patient with the
    // transcript preserved and a "Generate note" button for on-demand use.
    if (skipGenerationRef.current) {
      skipGenerationRef.current = false
      store.setCurrentNote({ patient, reg_number: regNumber, session_number: sessionNumber, attendance })
      store.setCurrentNoteId(null)
      store.setPendingTranscriptOnly(true)
      setPhase('idle')
      router.push('/edit')
      return
    }

    // A dictated psychiatrist note has already said what it is. The doctor
    // pressed "Start a psychiatrist note" and dictated against that checklist,
    // so asking them to choose from 116 templates afterwards makes them state
    // the same intention twice. Go straight to generation on Comprehensive
    // Psychology Note, widened to hold every topic the checklist asked for.
    //
    // Recording a session is NOT the same and keeps its picker: a recorded
    // consultation could legitimately be any template, and nothing about
    // pressing Record says which.
    if (creationMode === 'dictation') {
      void startDictatedNote(patient, regNumber, sessionNumber, attendance)
      return
    }

    // Keep the recovery draft until the note is durably saved (in the edit
    // page). Deleting it here risks losing the session if the tab reloads
    // before the note is persisted.
    setPhase('template-picking')
  }

  // Resolve Comprehensive Psychology Note and start generating with it. The
  // built-in file is large, so it is imported here rather than on every mount.
  // If it cannot be loaded the picker still opens — a doctor must never be left
  // holding a dictation with no way forward.
  async function startDictatedNote(
    patient: string, regNumber: string, sessionNumber: string, attendance: string,
  ) {
    let template: AnyTemplate | null = null
    try {
      const mod = await import('@/data/clinical-templates.json')
      const base = (mod.default as AnyTemplate[]).find(t => String(t.id) === DICTATION_TEMPLATE_ID)
      if (base) template = buildDictationTemplate(base)
    } catch { /* fall through to the picker */ }

    if (!template) { setPhase('template-picking'); return }

    store.resetHospitalForm()
    store.setCurrentNote({ patient, reg_number: regNumber, session_number: sessionNumber, attendance })
    store.setCurrentNoteId(null)
    store.setLastChosenTemplate(template)
    store.setPendingAnimation(true)
    if (user) {
      handoffRef.current = {
        ...handoffRef.current,
        templateId: DICTATION_TEMPLATE_ID,
        templateTitle: template.title,
        pendingGeneration: true,
      }
      void saveDraftHandoff(user.uid, handoffRef.current)
    }
    setPhase('idle')
    router.push('/edit')
  }

  // The paste pathway's picker can send this content to a letter or to the
  // patient's record instead of a note. Both reuse the transcript the doctor
  // already confirmed a patient for.
  function handlePasteLetter(type: LetterType, customTemplate?: CustomLetterTemplate | null) {
    setPhase('idle')
    startLetterFromTranscript(pendingTranscript, type, customTemplate, {
      patient: prefillPatient?.patient ?? '',
      mode: creationMode,
      existingPatient: existingPatientRef.current,
    })
  }

  // Fill the confirmed patient's tracked record from the pasted content, merging
  // into their existing profile when they already have one.
  async function handleAddPatientFromTranscript() {
    if (!user || !pendingTranscript.trim()) return
    const name = (prefillPatient?.patient ?? '').trim()
    if (!name) { setError('Add the patient details first.'); return }
    setPhase('idle')
    setPatientSaving(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const gk = getGroqKey()
      if (gk) headers['x-groq-key'] = gk
      const gemk = getGeminiKey()
      if (gemk) headers['x-gemini-key'] = gemk
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'patient-intake', source: 'paste', transcript: pendingTranscript, uid: user.uid }),
      })
      const data = await res.json() as { patientFields?: Record<string, unknown>; error?: string }
      if (!data.patientFields) throw new Error(data.error || 'Could not read the note')
      const extra = parsePatientIntakeFields(data.patientFields)

      const profiles = await getPatientProfiles(user.uid)
      const existing = Object.values(profiles).find(
        p => p.displayName.trim().toLowerCase() === name.toLowerCase()
      )
      // The DOB/gender the doctor typed in the naming step are explicit, so they
      // win over anything the AI inferred from the note.
      const entered = store.pendingPatientProfile
      const now = Date.now()
      // A field this note covers replaces what was there; a field it is silent
      // about is left alone. Other topics merge per topic rather than as one
      // block, so a progress-only round can't wipe an allergy recorded earlier.
      const mergedExtras = mergeExtras(existing?.extras, extra.extras)
      const merged: Partial<PatientProfile> = {
        ...extra,
        ...(mergedExtras.length ? { extras: mergedExtras, otherTopics: formatOtherTopics(mergedExtras) } : {}),
      }
      const history = appendPatientHistory(existing, merged, now)
      await savePatientProfile(user.uid, {
        ...(existing ?? { displayName: name }),
        ...merged,
        ...(history ? { history } : {}),
        ...(entered?.dob ? { dob: entered.dob } : {}),
        ...(entered?.gender ? { gender: entered.gender as PatientProfile['gender'] } : {}),
        // Keep the notes themselves, not just what the extractor made of them.
        // Every tracked field is a view over these; a hospital form is built
        // from the newest.
        entries: pushPatientEntry(existing?.entries, pendingTranscript, now),
        tracked: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(prefillPatient?.reg_number ? { urNumber: prefillPatient.reg_number } : {}),
      })
      store.setPendingPatientProfile(null)
      if (user) deleteTranscriptDraft(user.uid).catch(() => {})
      // Land on this patient's card with the details already open, so the
      // extracted fields are right there to check.
      router.push(`/patients?patient=${encodeURIComponent(name)}&expand=1`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the patient details.')
      // Only cleared on failure — on success the overlay stays up until this page
      // unmounts, so there's no flash of the generate screen mid-navigation.
      setPatientSaving(false)
    }
  }

  function handleTemplateSelect(template: AnyTemplate, noteLength: string) {
    // The 80-word / clinical-content minimum exists so a session note isn't
    // generated from nothing. Letters and the patient record don't need it, so
    // it's only enforced here, at the point a note template is actually chosen.
    if (!clinicalNoteMode && noteBlockRef.current) {
      setPhase('idle')
      setError(noteBlockRef.current)
      return
    }
    store.resetHospitalForm()
    if (clinicalNoteMode) {
      // Manual note: blank fields, no transcript, no AI generation.
      store.setLetterType(null)
      store.setCurrentNote({})
      store.setCurrentNoteId(null)
      store.setLastTranscript(null)
      store.setLastChosenTemplate(template)
      store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
      store.setPendingAnimation(false)
      setClinicalNoteMode(false)
      setPhase('idle')
      router.push('/edit')
      return
    }
    store.setCurrentNote({
      patient: prefillPatient?.patient ?? '',
      reg_number: prefillPatient?.reg_number ?? '',
      session_number: prefillPatient?.session_number ?? '',
      attendance: prefillPatient?.attendance ?? '',
    })
    store.setCurrentNoteId(null)
    store.setLastChosenTemplate(template)
    store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
    store.setPendingAnimation(true)

    // Record the template alongside the patient before navigating. The edit page
    // consumes pendingAnimation on mount, so if that mount never happens with
    // this store — a reload, a discarded tab — the intent to generate exists
    // nowhere else. Written, not awaited: the doctor is mid-navigation and the
    // net must not add latency to the path it protects.
    if (user) {
      handoffRef.current = {
        ...handoffRef.current,
        patient:        prefillPatient?.patient        ?? handoffRef.current.patient,
        reg_number:     prefillPatient?.reg_number     ?? handoffRef.current.reg_number,
        session_number: prefillPatient?.session_number ?? handoffRef.current.session_number,
        attendance:     prefillPatient?.attendance     ?? handoffRef.current.attendance,
        templateId: String(template.id),
        templateTitle: template.title,
        pendingGeneration: true,
      }
      void saveDraftHandoff(user.uid, handoffRef.current)
    }
    setPhase('idle')
    router.push('/edit')
  }

  return (
    <div
      className="h-full overflow-y-auto scrollbar-none pb-tabbar pt-header"
    >
      {/* Interrupted session banner */}
      {showBanner && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-[var(--r)] p-3 flex items-start gap-2">
          <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">Previous recording interrupted</p>
            <p className="text-xs text-amber-600 mt-0.5">Your last recording session may not have been fully captured.</p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('_ln_rec_interrupted'); setShowBanner(false) }}
            className="text-xs text-amber-500 hover:text-amber-700 font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-6 space-y-3">
        <div className="mb-2">
          <h1 className="text-lg font-semibold text-[var(--text)]">New note</h1>
          <p className="text-sm text-[var(--text2)]">Choose how to create your clinical note</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {recoveredDraft && (
          <div className="rounded-[var(--r-lg)] border border-amber-300 bg-amber-50 p-4 space-y-2">
            <p className="text-sm font-semibold text-amber-900">Recording not finished</p>
            <p className="text-xs text-amber-800">
              A recording was captured (~{recoveredDraft.text.trim().split(/\s+/).length} words) but no note was created — the patient details step wasn&apos;t completed. Add the patient details, or generate a note now from the transcript as it is.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={useRecoveredDraft}>Add patient details</Button>
              <Button variant="ghost" size="sm" onClick={generateFromDraftDirect}>Generate note now</Button>
              <Button variant="ghost" size="sm" onClick={discardRecoveredDraft}>Discard</Button>
            </div>
          </div>
        )}
        <ModeCard icon={PasteIcon} title="Paste Transcript or Ward Note" description="Session transcript, or a Bossnet note to fill patient details" onClick={handlePasteMode} />
        <ModeCard icon={RecordIcon} title="Record Session" description="In-person or telehealth recording" onClick={() => startMode('conversation')} />
        <ModeCard icon={DictateIcon} title="Dictate Note" description="Narrate the note yourself" onClick={() => startMode('dictation')} />

        {!hasGroqKey && (
          <p className="text-xs text-[var(--text3)] text-center mt-2 px-4">
            Add a{' '}
            <button
              onClick={() => openSettings('api-keys')}
              className="text-[var(--blue)] underline"
            >
              Groq API key
            </button>
            {' '}to enable voice recording modes.
          </p>
        )}

        <ModeCard icon={DocumentIcon} title="Create Document" description="Write a letter or clinical note" onClick={() => { setClinicalNoteMode(false); setLetterPickerOpen(true) }} />

        {/* Upload Recording - hidden in UI, code preserved */}
        <div style={{ display: 'none' }}>
          <ModeCard icon={UploadIcon} title="Upload Recording" description="Upload an audio file" onClick={() => startMode('upload')} />
        </div>
      </div>


      {/* How the content arrives: typed/pasted text, or a photo of a paper note */}
      <Modal open={phase === 'paste-choice'} onClose={handleCancel} title="Paste Transcript or Ward Note" maxWidth="lg">
        <div className="px-5 pb-5 space-y-3">
          <ModeCard
            icon={PasteIcon}
            title="Paste text"
            description="A session transcript, or a Bossnet note copied to the clipboard"
            onClick={() => setPhase('paste-input')}
          />
          <ModeCard
            icon={CameraIcon}
            title="Scan a ward note"
            description="Photograph a paper progress note — read on the spot, never stored"
            onClick={() => setPhase('scan-input')}
          />
        </div>
      </Modal>

      <ScanNoteModal
        open={phase === 'scan-input'}
        uid={user?.uid}
        onClose={handleCancel}
        onScanned={handleScannedNote}
      />

      {/* Paste transcript modal */}
      <Modal open={phase === 'paste-input'} onClose={handleCancel} title="Paste Transcript or Ward Note" maxWidth="lg">
        <div className="px-5 pb-5 space-y-4">
          <Textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            rows={10}
            placeholder="Paste a session transcript, or a ward note from Bossnet…"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCancel} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleTextConfirm} disabled={!inputText.trim()} className="flex-1">Continue</Button>
          </div>
        </div>
      </Modal>

      {/* Document input modal */}
      <Modal open={phase === 'document-input'} onClose={handleCancel} title="Create Document" maxWidth="lg">
        <div className="px-5 pb-5 space-y-4">
          <Textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            rows={10}
            placeholder="Paste document text here…"
            autoFocus
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCancel} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleTextConfirm} disabled={!inputText.trim()} className="flex-1">Continue</Button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="text-xs text-[var(--text3)]">or</span>
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>
          <button
            onClick={handleSkipToLetter}
            className="w-full text-xs text-[var(--blue)] font-medium hover:underline text-center motion-safe:transition-opacity">
            Skip - write a letter instead →
          </button>
        </div>
      </Modal>


      <RecordModal
        open={phase === 'recording'}
        onClose={handleCancel}
        onTranscriptReady={handleTranscriptReady}
        recordingDefaults={profile?.recordingDefaults}
        hasInterruptedDraft={!!recoveredDraft}
      />
      <DictateModal
        open={phase === 'dictating'}
        onClose={handleCancel}
        onTranscriptReady={handleTranscriptReady}
        onHospitalFormReady={handleDictatedHospitalForm}
        recordingDefaults={profile?.recordingDefaults}
        hasInterruptedDraft={!!recoveredDraft}
        customTemplates={profile?.customLetterTemplates ?? []}
        hospitalForms={hospitalForms}
      />
      <TranscriptConfirmModal
        open={transcriptConfirmOpen}
        transcript={pendingTranscript}
        allNotes={allNotes}
        patientProfiles={patientProfileList}
        prefill={scanPrefill}
        onConfirm={handleTranscriptConfirmPatient}
        onClose={() => { setTranscriptConfirmOpen(false); setPendingTranscript(''); setScanPrefill(null) }}
      />
      <TemplatePicker
        open={phase === 'template-picking'}
        onSelect={handleTemplateSelect}
        onCancel={() => {
          setPhase('idle')
          if (clinicalNoteMode) {
            setClinicalNoteMode(false)
            setLetterPickerOpen(true)
          } else {
            setTranscriptConfirmOpen(true)
          }
        }}
        {...(clinicalNoteMode ? {} : {
          onSelectLetter: (type: LetterType) => handlePasteLetter(type),
          customLetterTemplates: profile?.customLetterTemplates ?? [],
          onSelectCustomLetter: (t: CustomLetterTemplate) => handlePasteLetter('custom', t),
          onCreateLetterTemplate: () => { setPhase('idle'); setCustomBuilderOpen(true) },
          onAddPatient: handleAddPatientFromTranscript,
          // Lets the picker say what Skip will do, and route a ward note to the
          // patient record rather than writing a note from a copied record.
          // A SCAN defaults to ward-note whatever the classifier scores — the
          // doctor pressed "Scan a ward note", and OCR of handwriting is the one
          // input the classifier reads worst. See resolvePastedKind.
          pastedKind: resolvePastedKind(classifyPastedText(pendingTranscript), pendingSourceRef.current),
        })}
      />
      <LetterPickerModal
        open={letterPickerOpen}
        onSelect={handleLetterTypeSelected}
        onSelectClinicalNote={handleSelectClinicalNote}
        onClose={() => setLetterPickerOpen(false)}
        customTemplates={profile?.customLetterTemplates ?? []}
        onSelectCustom={handleCustomLetterSelected}
        onCreateTemplate={() => { setLetterPickerOpen(false); setCustomBuilderOpen(true) }}
        hospitalForms={hospitalForms}
        onSelectHospitalForm={handleSelectHospitalForm}
      />
      <Modal open={patientSaving} onClose={() => {}} title="Adding patient details" maxWidth="sm">
        <div className="px-5 pb-6 text-center">
          <svg width="28" height="28" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)] mx-auto mb-3" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
          </svg>
          <p className="text-sm text-[var(--text2)]">Reading the note and filling the fields…</p>
        </div>
      </Modal>

      <CustomLetterBuilderModal
        open={customBuilderOpen}
        onSave={handleSaveCustomTemplate}
        onClose={() => setCustomBuilderOpen(false)}
      />
    </div>
  )
}
