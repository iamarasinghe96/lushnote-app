'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { openSettings, quotaDate, getGroqKey, getGeminiKey, parsePatientIntakeFields, appendPatientHistory, mergeExtras, formatOtherTopics, pushPatientEntry } from '@/lib/utils'
import { classifyPastedText, resolvePastedKind, type PastedSource } from '@/lib/pastedText'
import { classifyCaptureIntent, type CaptureSource, type IntentClassification } from '@/lib/captureIntent'
import { suggestedActions, type ActionKey } from '@/lib/suggestedActions'
import { pickCaptureTemplate, actionBlocker, isTrackedPatient, DISCHARGE_TEMPLATE_ID, type TemplateReason } from '@/lib/captureFlow'
import { exportPatientsPDF } from '@/lib/patientPdf'
import CaptureReviewCard from '@/components/capture/CaptureReviewCard'
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
import { listTranscriptDrafts, deleteTranscriptDraft, saveDraftHandoff, type TranscriptDraft } from '@/lib/firestore/transcriptDrafts'
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
  // The newest unfinished recording, plus how many there are in total. Drafts
  // are per recording session now, so a doctor can genuinely have more than one
  // — each is listed in Patients; the banner offers the most recent.
  const [recoveredDraft, setRecoveredDraft] = useState<TranscriptDraft | null>(null)
  const [draftCount, setDraftCount] = useState(0)
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
  // ── The capture hub's unattended path ──────────────────────────────────────
  // A capture started from the FAB skips the naming step and the template
  // picker and lands on the review card instead. A ref, not state: it is read in
  // the same tick the transcript arrives, before a state update would land, and
  // it is consumed on first use so a later capture started from the mode cards
  // keeps its own modals.
  const captureHubRef = useRef(false)
  const [captureReview, setCaptureReview] = useState<
    { stage: 'reading' | 'ready'; classification: IntentClassification; transcript: string } | null
  >(null)
  const [captureName, setCaptureName] = useState('')
  // Identity the extractor read off the capture, kept apart from the name so an
  // edit to the name does not silently discard the DOB and sex that came with it.
  // `sex` is narrowed HERE, at the boundary, rather than where it is used. It
  // arrives as free text from a model, and the server already refuses to infer
  // it from a name; anything that is not one of the two values the record holds
  // is dropped rather than carried inward as a string nobody validated.
  const captureIdentityRef = useRef<{ dob: string; sex: '' | 'male' | 'female'; regNumber: string }>({ dob: '', sex: '', regNumber: '' })
  const [captureTemplate, setCaptureTemplate] = useState<{ id: string; title: string; reason: TemplateReason } | null>(null)

  // Accumulates across the two steps that fill it — naming the patient, then
  // picking the template — so the second write does not erase the first.
  const handoffRef = useRef<DraftHandoff>(EMPTY_HANDOFF)
  // The draft the work in hand belongs to. A ref because the handoff is written
  // in the same tick the doctor confirms, before a state update would land.
  const activeDraftIdRef = useRef<string>('')

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
    // Started from the capture button: the review card takes over from here. The
    // OCR already read the label, so the name is in hand and no identity call is
    // needed — the card opens ready rather than pretending to work.
    if (captureHubRef.current) {
      captureHubRef.current = false
      captureIdentityRef.current = {
        dob: patient.dob,
        sex: patient.gender === 'male' || patient.gender === 'female' ? patient.gender : '',
        regNumber: patient.urNumber,
      }
      openCaptureReview(trimmed, 'photo', patient.name)
      return
    }
    setTranscriptConfirmOpen(true)
  }

  function handleCancel() {
    // A cancelled capture must not leave the flag set, or the NEXT capture —
    // possibly started from a mode card — would skip the steps that card implies.
    captureHubRef.current = false
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
    listTranscriptDrafts(user.uid).then(list => {
      setDraftCount(list.length)
      const d = list[0]
      if (!d) return
      setRecoveredDraft(d)
      // Arriving from a Patients unfinished row (?recover=1&draft=<id>) skips
      // the banner and drops the doctor straight into naming THAT recording —
      // not merely the newest, which would open the wrong patient's session.
      if (typeof window === 'undefined') return
      const params = new URLSearchParams(window.location.search)
      if (params.get('recover') !== '1') return
      const wanted = params.get('draft')
      const target = wanted ? list.find(x => x.id === wanted) : d
      if (target) { setRecoveredDraft(target); recoverDraftIntoNaming(target) }
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  // Arriving from the capture button (?capture=record | photo). The FAB lives in
  // the app layout and these modals live here, so it deep-links rather than
  // duplicating the wiring — the same shape as the ?recover=1 link from
  // Patients. Nothing about the capture itself changes; the doctor simply starts
  // one from anywhere instead of navigating to Generate first.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const capture = new URLSearchParams(window.location.search).get('capture')
    if (capture !== 'record' && capture !== 'photo') return
    // Go through the same entry points the mode cards use, so the deep link
    // cannot drift from them — each one clears the previous attempt's error,
    // input text and scan prefill before opening its modal.
    //
    // The flag is what separates the two ways in. A capture started HERE runs
    // the steps unattended and ends on the review card; the same modal reached
    // from a mode card keeps the naming step and the picker, because a doctor
    // who walked in through them has already chosen to walk through them.
    captureHubRef.current = true
    if (capture === 'record') startMode('conversation')
    else { handlePasteMode(); setPhase('scan-input') }
    // Drop the parameter so a refresh does not reopen the modal over a recording
    // the doctor has already finished — or worse, over a recovery banner.
    router.replace('/generate', { scroll: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The modals now record and transcribe live in segments and hand us the
  // finished transcript text. All we do here is route it into the note or
  // letter flow.
  async function handleTranscriptReady(text: string, duration: number, draftId: string, letterType?: LetterType | null, customTemplateId?: string) {
    // Remember which draft this recording wrote to, so whatever it becomes —
    // note, letter or form — clears that one and not another patient's.
    store.setActiveDraftId(draftId)
    activeDraftIdRef.current = draftId
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
    // Started from the capture button: run the steps and present the card.
    if (captureHubRef.current) {
      captureHubRef.current = false
      void openCaptureReview(text, 'audio')
      return
    }
    setTranscriptConfirmOpen(true)
  }

  /**
   * The unattended path: classify what was captured, find out who it is about,
   * and open the review card.
   *
   * Classification is local and instant. The identity read is one cheap AI call
   * — deliberately separate from note generation, which runs only after the
   * doctor taps, so a discarded capture never costs a note-sized request or one
   * of the 20 daily Gemini calls.
   */
  async function openCaptureReview(text: string, source: CaptureSource, knownName = '') {
    const classification = classifyCaptureIntent(text, source)
    captureIdentityRef.current = knownName
      ? captureIdentityRef.current
      : { dob: '', sex: '', regNumber: '' }
    setCaptureName(knownName)
    setCaptureTemplate(null)
    setCaptureReview({ stage: knownName ? 'ready' : 'reading', classification, transcript: text })
    setPhase('idle')

    // Resolve the template the note action will use, so the card can show it
    // before it is committed to. Failing to load it is not a blocker: the card
    // simply shows no template and the note action falls back to the picker.
    void resolveCaptureTemplate()

    if (knownName || !user) {
      setCaptureReview(r => (r ? { ...r, stage: 'ready' } : r))
      return
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const gk = getGroqKey()
      if (gk) headers['x-groq-key'] = gk
      const gemk = getGeminiKey()
      if (gemk) headers['x-gemini-key'] = gemk
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'capture-identity', transcript: text, uid: user.uid }),
      })
      const data = await res.json() as { identity?: Record<string, string> }
      const id = data.identity ?? {}
      const sex = String(id.sex ?? '')
      captureIdentityRef.current = {
        dob: String(id.dob ?? ''),
        sex: sex === 'male' || sex === 'female' ? sex : '',
        regNumber: String(id.regNumber ?? ''),
      }
      setCaptureName(String(id.patientName ?? ''))
    } catch {
      // A failed read costs one tap — the card asks for the name. Blocking the
      // capture over a field that is optional anyway would be worse.
    }
    setCaptureReview(r => (r ? { ...r, stage: 'ready' } : r))
  }

  async function resolveCaptureTemplate() {
    let recent: (string | number)[] = []
    try {
      const stored = localStorage.getItem('lnTemplateUsage')
      const parsed = stored ? JSON.parse(stored) as unknown : null
      if (Array.isArray(parsed)) recent = parsed as (string | number)[]
    } catch { /* no history — pickCaptureTemplate falls back to the default */ }

    const choice = pickCaptureTemplate(recent)
    const template = await findCaptureTemplate(choice.id)
    if (template) setCaptureTemplate({ id: String(template.id), title: template.title, reason: choice.reason })
  }

  /** Built-ins live in the large JSON file, custom templates on the profile. */
  async function findCaptureTemplate(id: string): Promise<AnyTemplate | null> {
    const custom = (profile?.customTemplates ?? []).find(t => String(t.id) === id)
    if (custom) return custom as AnyTemplate
    try {
      const mod = await import('@/data/clinical-templates.json')
      return (mod.default as AnyTemplate[]).find(t => String(t.id) === id) ?? null
    } catch {
      return null
    }
  }

  function closeCaptureReview() {
    setCaptureReview(null)
    setCaptureTemplate(null)
    setCaptureName('')
  }

  /**
   * A tap on the card. This IS the confirmation — every step it stands in for
   * has already run — so it must never be able to do the thing the card was
   * showing as blocked.
   */
  function handleCaptureAction(key: ActionKey) {
    const review = captureReview
    if (!review) return
    const name = captureName.trim()
    // The card disables a blocked action; re-checking here is not belt and
    // braces. `patient-record` supersedes tracked fields, and the gap between
    // rendering and tapping is exactly where the name can have been cleared.
    if (actionBlocker(key, { transcript: review.transcript, patientName: name })) return

    const identity = captureIdentityRef.current
    setCaptureReview(null)
    setCaptureTemplate(null)

    // Everything below hands off to the pathway that already exists. The card
    // decides WHICH one; it does not carry a second copy of any of them.
    //
    // The transcript goes into the store HERE, because the naming step the card
    // replaced is what used to do it — and without it the edit page arrives with
    // a template, a patient and nothing to generate from.
    store.setLastTranscript(review.transcript)
    store.setLastTranscriptMode(creationMode)
    setPrefillPatient({ patient: name, reg_number: identity.regNumber, session_number: '', attendance: '' })

    // A profile is created ONLY for a patient who does not have one. The naming
    // step gates this on `isNewPatient` for a reason the card has to honour too:
    // savePatientProfile with no id calls addDoc, so doing it for an existing
    // patient does not update them — it adds a SECOND card holding a name, a DOB
    // and nothing else, and splits their record across the two.
    const alreadyTracked = isTrackedPatient(name, patientProfileList)
    existingPatientRef.current = alreadyTracked
    store.setPendingPatientProfile(
      !alreadyTracked && (identity.dob || identity.sex) ? { dob: identity.dob, gender: identity.sex } : null
    )

    // The card replaced the naming step, so it inherits the naming step's job of
    // putting the name somewhere a page load survives. Without this a reload
    // between the tap and the edit page resurfaces the recording as "Unnamed"
    // with the name we already had thrown away.
    if (user && key !== 'other') {
      handoffRef.current = {
        ...handoffRef.current,
        patient: name,
        reg_number: identity.regNumber,
        dob: identity.dob,
        gender: identity.sex,
      }
      void saveDraftHandoff(user.uid, activeDraftIdRef.current, handoffRef.current)
    }

    if (key === 'other') {
      // The escape hatch: back to the naming step the card replaced, with what
      // was extracted pre-filled so nothing has to be typed twice.
      setScanPrefill({ patient: name, regNumber: identity.regNumber, dob: identity.dob, gender: identity.sex })
      setTranscriptConfirmOpen(true)
      return
    }

    // The campus's own progress-note form. It carries the LATEST entry, which is
    // exactly what this capture is, so the transcript goes straight in and
    // generation fills the ruled lines — the same path DictateModal already uses.
    if (key === 'hospital-form') {
      if (captureForm) startHospitalForm(captureForm, review.transcript)
      else setPhase('template-picking')
      return
    }

    if (key === 'letter') {
      startLetterFromTranscript(review.transcript, 'freetext', null, {
        patient: name, mode: creationMode, existingPatient: alreadyTracked,
      })
      return
    }

    // Both halves of the ward round: the record write, then the handover sheet
    // printed from what it just wrote. One button because they are one job.
    if (key === 'patient-record' || key === 'patient-pdf') {
      void handleAddPatientFromTranscript(
        { patient: name, reg_number: identity.regNumber, dob: identity.dob, gender: identity.sex },
        { thenExportPdf: key === 'patient-pdf' },
      )
      return
    }

    // The discharge summary has its own template — the doctor is closing off an
    // admission, which is a document, not a preference. It does NOT go through
    // the card's template row, which describes what a plain note would use.
    if (key === 'discharge-summary') {
      const known = { patient: name, reg_number: identity.regNumber, session_number: '', attendance: '' }
      void findCaptureTemplate(DISCHARGE_TEMPLATE_ID).then(t => {
        if (t) handleTemplateSelect(t, store.overrideNoteLength ?? 'balanced', known)
        else setPhase('template-picking')
      })
      return
    }

    // A capture that did not pass the clinical-content check is never thrown
    // away, but nor is a note generated from it — the same verdict the naming
    // step reaches. It lands on the edit page saved under the patient with the
    // transcript intact and a Generate button, rather than spending one of the
    // 20 daily calls on twenty words.
    if (skipGenerationRef.current) {
      skipGenerationRef.current = false
      store.setCurrentNote({ patient: name, reg_number: identity.regNumber })
      store.setCurrentNoteId(null)
      store.setPendingTranscriptOnly(true)
      setPhase('idle')
      router.push('/edit')
      return
    }

    // A note. Generate on the template the card was showing; if it never
    // resolved, fall back to the picker rather than guessing silently.
    if (!captureTemplate) { setPhase('template-picking'); return }
    const known = { patient: name, reg_number: identity.regNumber, session_number: '', attendance: '' }
    void findCaptureTemplate(captureTemplate.id).then(t => {
      if (t) handleTemplateSelect(t, store.overrideNoteLength ?? 'balanced', known)
      else setPhase('template-picking')
    })
  }

  // Derived once: the render reads it twice — for the buttons, and to decide
  // whether the template row describes anything the doctor is about to press.
  // The campus form is offered only where one is configured for the active
  // workplace. `hospitalForms` is already campus-gated, so an empty list is the
  // ordinary case and the card simply does not mention forms.
  const captureForm = hospitalForms[0] ?? null
  const captureActions = captureReview
    ? suggestedActions(captureReview.classification, { hospitalFormName: captureForm?.name ?? null })
    : []

  /** "Change" on the card — hand the choice back without losing the capture. */
  function changeCaptureTemplate() {
    const name = captureName.trim()
    setCaptureReview(null)
    setPrefillPatient({ patient: name, reg_number: captureIdentityRef.current.regNumber, session_number: '', attendance: '' })
    setPhase('template-picking')
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
  function recoverDraftIntoNaming(d: TranscriptDraft) {
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
    // Adopt this draft as the one in hand, so the handoff written at the naming
    // step lands on it and the edit page later clears it — not some other
    // patient's unfinished recording.
    activeDraftIdRef.current = d.id
    store.setActiveDraftId(d.id)
    beginPendingTranscript(d.text, 'paste')
    setTranscriptConfirmOpen(true)
  }

  function useRecoveredDraft() {
    if (recoveredDraft) recoverDraftIntoNaming(recoveredDraft)
  }

  function discardRecoveredDraft() {
    const id = recoveredDraft?.id
    if (user && id) deleteTranscriptDraft(user.uid, id).catch(() => {})
    setRecoveredDraft(null)
    setDraftCount(c => Math.max(0, c - 1))
  }

  // Generate a note straight from a recovered transcript WITHOUT the patient
  // name/age/gender step. The edit page shows an "incomplete information"
  // warning; the note won't persist until a patient name is entered.
  function generateFromDraftDirect() {
    const d = recoveredDraft
    if (!d) return
    // Same reason as recoverDraftIntoNaming: whatever this becomes must clear
    // THIS draft when it is durably saved, not another recording's.
    activeDraftIdRef.current = d.id
    store.setActiveDraftId(d.id)
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
      void saveDraftHandoff(user.uid, activeDraftIdRef.current, handoffRef.current)
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
      void saveDraftHandoff(user.uid, activeDraftIdRef.current, handoffRef.current)
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
  // `known` is passed by the capture card, which decides the patient and calls
  // this in the same tick — `prefillPatient` is state and would still hold the
  // previous capture's value at that point.
  async function handleAddPatientFromTranscript(
    known?: { patient: string; reg_number: string; dob: string; gender: string },
    opts?: { thenExportPdf?: boolean },
  ) {
    if (!user || !pendingTranscript.trim()) return
    const name = (known?.patient ?? prefillPatient?.patient ?? '').trim()
    const regNumber = known?.reg_number ?? prefillPatient?.reg_number ?? ''
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
      // win over anything the AI inferred from the note. Same staleness reason
      // as the name: the capture card supplies them directly.
      const entered = known ?? store.pendingPatientProfile
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
      const saved: PatientProfile = {
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
        ...(regNumber ? { urNumber: regNumber } : {}),
      }
      await savePatientProfile(user.uid, saved)
      // The handover sheet is drawn from what was just written, not re-read: a
      // read-back would race the write, and this is the same object Firestore
      // holds. jsPDF is code-split, so it only loads when a sheet is asked for.
      if (opts?.thenExportPdf) await exportPatientsPDF([saved]).catch(() => {})
      store.setPendingPatientProfile(null)
      if (user && activeDraftIdRef.current) deleteTranscriptDraft(user.uid, activeDraftIdRef.current).catch(() => {})
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

  // `known` is the capture card's patient, for the same reason as
  // handleAddPatientFromTranscript: it picks the template and calls this in one
  // tick, when `prefillPatient` still holds the previous capture's value.
  function handleTemplateSelect(
    template: AnyTemplate,
    noteLength: string,
    known?: { patient: string; reg_number: string; session_number: string; attendance: string },
  ) {
    const chosen = known ?? prefillPatient
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
      patient: chosen?.patient ?? '',
      reg_number: chosen?.reg_number ?? '',
      session_number: chosen?.session_number ?? '',
      attendance: chosen?.attendance ?? '',
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
        patient:        chosen?.patient        ?? handoffRef.current.patient,
        reg_number:     chosen?.reg_number     ?? handoffRef.current.reg_number,
        session_number: chosen?.session_number ?? handoffRef.current.session_number,
        attendance:     chosen?.attendance     ?? handoffRef.current.attendance,
        templateId: String(template.id),
        templateTitle: template.title,
        pendingGeneration: true,
      }
      void saveDraftHandoff(user.uid, activeDraftIdRef.current, handoffRef.current)
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
            <p className="text-sm font-semibold text-amber-900">Finish your last recording</p>
            {/* Say what it is and that it is safe. Anything more is explaining
                the app instead of offering the next tap. */}
            <p className="text-xs text-amber-800">
              ~{recoveredDraft.text.trim().split(/\s+/).length} words, saved.
              {draftCount > 1 ? ` ${draftCount - 1} more in Patients.` : ''}
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

      {/* What a capture started from the FAB lands on, in place of the naming
          step and the template picker it ran unattended. */}
      <CaptureReviewCard
        open={captureReview !== null}
        stage={captureReview?.stage ?? 'reading'}
        classification={captureReview?.classification ?? null}
        transcript={captureReview?.transcript ?? ''}
        actions={captureActions}
        patientName={captureName}
        onPatientNameChange={setCaptureName}
        // Shown only when a plain note LEADS. On a discharge or a ward note the
        // row would describe a button the doctor is not about to press — the
        // discharge summary has its own template, and the record write has none.
        template={captureTemplate && captureActions[0]?.key === 'note'
          ? { title: captureTemplate.title, reason: captureTemplate.reason }
          : null}
        onChangeTemplate={changeCaptureTemplate}
        onAction={handleCaptureAction}
        onClose={closeCaptureReview}
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
