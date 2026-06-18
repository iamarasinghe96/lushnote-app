'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { openSettings, quotaDate } from '@/lib/utils'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Textarea from '@/components/ui/Textarea'
import RecordModal from '@/components/modals/RecordModal'
import DictateModal from '@/components/modals/DictateModal'
import TranscriptConfirmModal from '@/components/modals/TranscriptConfirmModal'
import TemplatePicker from '@/components/modals/TemplatePicker'
import LetterPickerModal from '@/components/modals/LetterPickerModal'
import { listNotes } from '@/lib/firestore/notes'
import type { AnyTemplate, NoteCreationMode, Note, LetterType } from '@/types'

const GEMINI_RPD = 20

type GenPhase =
  | 'idle'
  | 'paste-input'
  | 'document-input'
  | 'upload-input'
  | 'recording'
  | 'dictating'
  | 'transcribing'
  | 'template-picking'
  | 'generating'

function validateTranscript(text: string): { valid: boolean; error?: string } {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  if (wordCount < 80)
    return { valid: false, error: `Transcript too short (${wordCount} words). Minimum 80 words required.` }
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
      className="w-full text-left rounded-[var(--r-lg)] bg-white border border-[var(--border)]
                 p-4 flex items-start gap-3 hover:border-[var(--blue)] hover:shadow-md
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
const UploadIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <polyline points="16,16 12,12 8,16"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
  </svg>
)


export default function GeneratePage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const store = useNoteStore()

  const [phase, setPhase] = useState<GenPhase>('idle')
  const [inputText, setInputText] = useState('')
  const [pendingTranscript, setPendingTranscript] = useState('')
  const [creationMode, setCreationMode] = useState<NoteCreationMode>('paste')
  const [error, setError] = useState<string | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [transcriptConfirmOpen, setTranscriptConfirmOpen] = useState(false)
  const [prefillPatient, setPrefillPatient] = useState<{ patient: string; reg_number: string } | null>(null)
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const [letterPickerOpen, setLetterPickerOpen] = useState(false)

  useEffect(() => {
    if (localStorage.getItem('_ln_rec_interrupted')) {
      setShowBanner(true)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    listNotes(user.uid).then(setAllNotes).catch(() => {})
  }, [user?.uid])

  // Refresh notes when the confirm modal opens so the daily reg counter
  // and patient index reflect anyone registered earlier this session.
  useEffect(() => {
    if (transcriptConfirmOpen && user) {
      listNotes(user.uid).then(setAllNotes).catch(() => {})
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

  function handleLetterTypeSelected(type: LetterType) {
    setLetterPickerOpen(false)
    const today = new Date()
    const dd = String(today.getDate()).padStart(2, '0')
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const yyyy = today.getFullYear()
    store.setLetterType(type)
    store.setLetterCommonFields({ letterDate: `${dd}/${mm}/${yyyy}` })
    router.push('/edit')
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

  async function handlePasteMode() {
    setCreationMode('paste')
    setError(null)
    setInputText('')
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        const validation = validateTranscript(text.trim())
        if (!validation.valid) {
          setError(validation.error!)
          return
        }
        setPendingTranscript(text.trim())
        setTranscriptConfirmOpen(true)
        return
      }
    } catch {
      // clipboard access denied or unavailable - fall through to textarea
    }
    setPhase('paste-input')
  }

  function handleCancel() {
    setPhase('idle')
    setInputText('')
    setPendingTranscript('')
    setError(null)
    setTranscriptConfirmOpen(false)
    setPrefillPatient(null)
  }

  function handleTextConfirm() {
    if (!inputText.trim()) return
    const text = inputText.trim()
    setInputText('')
    setPhase('idle')
    const validation = validateTranscript(text)
    if (!validation.valid) {
      setError(validation.error!)
      return
    }
    setPendingTranscript(text)
    setTranscriptConfirmOpen(true)
  }

  async function handleAudioReady(blob: Blob, mimeType: string, duration: number) {
    store.setLastRecordingDuration(duration)
    setPhase('transcribing')
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'audio.webm')
      formData.append('mimeType', mimeType)
      formData.append('uid', user!.uid)

      const headers: Record<string, string> = {}
      const groqKey = sessionStorage.getItem('groq_api_key')
      if (groqKey) headers['x-groq-key'] = groqKey

      const res = await fetch('/api/transcribe', { method: 'POST', headers, body: formData })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Transcription failed')
      }
      const data = await res.json() as { text: string }
      const validation = validateTranscript(data.text)
      if (!validation.valid) {
        setError(validation.error!)
        setPhase('idle')
        return
      }
      setPendingTranscript(data.text)
      setTranscriptConfirmOpen(true)
      setPhase('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transcription failed')
      setPhase('idle')
    }
  }

  function handleTranscriptConfirmPatient(
    patient: string,
    regNumber: string,
    dob: string,
    gender: 'male' | 'female' | '',
    isNewPatient: boolean,
  ) {
    setTranscriptConfirmOpen(false)
    setPrefillPatient({ patient, reg_number: regNumber })
    store.setLastTranscript(pendingTranscript)
    store.setLastTranscriptMode(creationMode)
    store.setPendingPatientProfile(isNewPatient ? { dob, gender } : null)
    setPhase('template-picking')
  }

  function handleTemplateSelect(template: AnyTemplate, noteLength: string) {
    store.setCurrentNote({
      patient: prefillPatient?.patient ?? '',
      reg_number: prefillPatient?.reg_number ?? '',
    })
    store.setCurrentNoteId(null)
    store.setLastChosenTemplate(template)
    store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
    store.setPendingAnimation(true)
    setPhase('idle')
    router.push('/edit')
  }

  return (
    <div
      className="h-full overflow-y-auto"
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

        <ModeCard icon={PasteIcon} title="Paste Transcript" description="Reads clipboard automatically" onClick={handlePasteMode} />
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

        <ModeCard icon={DocumentIcon} title="Create Document" description="Paste or upload a text document" onClick={() => startMode('document')} />

        {/* Upload Recording - hidden in UI, code preserved */}
        <div style={{ display: 'none' }}>
          <ModeCard icon={UploadIcon} title="Upload Recording" description="Upload an audio file" onClick={() => startMode('upload')} />
        </div>
      </div>


      {/* Paste transcript modal */}
      <Modal open={phase === 'paste-input'} onClose={handleCancel} title="Paste Transcript" maxWidth="lg">
        <div className="px-5 pb-5 space-y-4">
          <Textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            rows={10}
            placeholder="Paste your session transcript here…"
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

      {/* Transcribing overlay */}
      {phase === 'transcribing' && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-3">
          <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)]" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
          </svg>
          <p className="text-sm font-medium text-[var(--text2)]">Transcribing audio…</p>
        </div>
      )}


      <RecordModal
        open={phase === 'recording'}
        onClose={handleCancel}
        onAudioReady={handleAudioReady}
        recordingDefaults={profile?.recordingDefaults}
      />
      <DictateModal
        open={phase === 'dictating'}
        onClose={handleCancel}
        onAudioReady={handleAudioReady}
        recordingDefaults={profile?.recordingDefaults}
      />
      <TranscriptConfirmModal
        open={transcriptConfirmOpen}
        transcript={pendingTranscript}
        allNotes={allNotes}
        onConfirm={handleTranscriptConfirmPatient}
        onClose={() => { setTranscriptConfirmOpen(false); setPendingTranscript('') }}
      />
      <TemplatePicker
        open={phase === 'template-picking'}
        onSelect={handleTemplateSelect}
        onCancel={() => { setPhase('idle'); setTranscriptConfirmOpen(true) }}
      />
      <LetterPickerModal
        open={letterPickerOpen}
        onSelect={handleLetterTypeSelected}
        onClose={() => setLetterPickerOpen(false)}
      />
    </div>
  )
}
