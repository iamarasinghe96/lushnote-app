'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useSegmentedRecorder } from '@/hooks/useSegmentedRecorder'
import { useAuth } from '@/hooks/useAuth'
import type { RecordingDefaults, LetterType } from '@/types'

interface DictateModalProps {
  open: boolean
  onClose: () => void
  onTranscriptReady: (text: string, duration: number, letterType?: LetterType | null) => void
  recordingDefaults?: RecordingDefaults
  // Whether a genuinely recoverable transcript draft exists in Firestore right
  // now (the same signal that drives the Generate-page recovery banner and
  // the Patients "Unnamed patient" row) — NOT a localStorage tripwire that
  // just remembers "a recording once started." Only real, unresolved data
  // should trigger the "previous recording was interrupted" warning below.
  hasInterruptedDraft?: boolean
}

type Phase = 'choice' | 'letter-type' | 'idle' | 'recording' | 'processing'

const LETTER_OPTIONS: { type: LetterType; title: string; description: string; icon: React.ReactNode }[] = [
  {
    type: 'referral',
    title: 'Referral Letter',
    description: 'Refer a patient to a specialist, unit, or service',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    ),
  },
  {
    type: 'records',
    title: 'Request Medical Records',
    description: 'Request clinical notes, investigations, or discharge summaries',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    type: 'freetext',
    title: 'Free Text Letter',
    description: 'Dictate a custom letter with your own content',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
  },
]

// Points the doctor should cover aloud while dictating, surfaced so the AI has
// the information it needs to populate each letter type's fields.
const LETTER_GUIDE: Record<LetterType, string[]> = {
  referral: [
    'Receiving doctor or specialist’s name',
    'Patient’s age and gender',
    'Admission unit and admission dates',
    'Presenting complaint',
    'Brief clinical course and relevant history',
    'Reason for referral',
    'Relevant past medical history',
    'Current medications',
  ],
  records: [
    'Previous provider or location holding the records',
    'What you need — correspondence, investigations, discharge summaries',
    'Any additional context or urgency',
  ],
  freetext: [
    'Who the letter is addressed to',
    'The purpose of the letter',
    'The key points you want to convey',
  ],
}

// Same idea as LETTER_GUIDE, for the plain psychiatrist-note path (no
// letterType) — covers the sections most clinical templates draw from, so
// mentioning each aloud gives the AI enough to populate the note fully.
const NOTE_GUIDE: string[] = [
  'Presenting complaint and reason for this review',
  'Relevant history — psychiatric, medical, social, family, or developmental as relevant',
  'Current medications, adherence, and any side effects',
  'Mental state examination — appearance, mood, affect, thought, perception, cognition',
  'What was discussed or covered in the session',
  'Any rating scale scores completed today',
  'Risk — self-harm, suicidal ideation or intent, harm to others, safeguarding concerns',
  'Referrals made or correspondence to send',
  'Management plan and next steps',
]

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function DictateModal({ open, onClose, onTranscriptReady, recordingDefaults, hasInterruptedDraft }: DictateModalProps) {
  const [phase, setPhase] = useState<Phase>('choice')
  const [letterType, setLetterType] = useState<LetterType | null>(null)
  const [interrupted, setInterrupted] = useState(false)
  const [autoStopped, setAutoStopped] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const { duration, audioSavedMin, transcribedMin, failures, lastError, audioError, draftError, start, stop, error: recError } = useSegmentedRecorder()
  const { user } = useAuth()

  const autoStopMinutes = recordingDefaults?.autoStop === false
    ? null
    : (recordingDefaults?.autoStopMinutes ?? 55)

  useEffect(() => {
    if (open) setInterrupted(!!hasInterruptedDraft)
  }, [open, hasInterruptedDraft])

  useEffect(() => {
    if (!open) {
      setPhase('choice')
      setLetterType(null)
      setAutoStopped(false)
      setInterrupted(false)
      setPermError(null)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      if (autoStopRef.current) {
        clearTimeout(autoStopRef.current)
        autoStopRef.current = null
      }
    }
  }, [open])

  async function doStop() {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
    setPhase('processing')
    const result = await stop()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    onTranscriptReady(result.text, result.duration, letterType)
  }

  stopRef.current = doStop

  async function handleStart() {
    setPermError(null)
    if (!user) { setPermError('Please sign in and try again.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      start(stream, { uid: user.uid, mode: 'dictation', letterType })
      setPhase('recording')
      if (autoStopMinutes !== null) {
        autoStopRef.current = setTimeout(() => {
          setAutoStopped(true)
          stopRef.current?.()
        }, autoStopMinutes * 60 * 1000)
      }
    } catch {
      setPermError('Microphone access denied. Please allow access and try again.')
    }
  }

  const selectedLabel = letterType ? LETTER_OPTIONS.find(o => o.type === letterType)?.title : null

  return (
    <Modal open={open} onClose={phase === 'recording' ? () => {} : onClose} title="Dictate Note" maxWidth="md">
      <div className="px-5 pb-5 space-y-4">
        {interrupted && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            A previous recording was interrupted.
          </div>
        )}
        {autoStopped && autoStopMinutes !== null && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            Recording stopped automatically after {autoStopMinutes} minutes.
          </div>
        )}
        {(permError ?? recError) && (
          <p className="text-sm text-[var(--danger)]">{permError ?? recError}</p>
        )}

        {/* Choice — psychiatrist note vs letter */}
        {phase === 'choice' && (
          <>
            <p className="text-sm text-[var(--text2)]">
              What would you like to dictate?
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => { setLetterType(null); setPhase('idle') }}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
                  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                  focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                  motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150"
                style={{
                  background: 'rgba(255,255,255,0.75)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                }}
              >
                <span className="text-[#10b981] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="9" y1="13" x2="15" y2="13"/>
                    <line x1="9" y1="17" x2="13" y2="17"/>
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Start a psychiatrist note</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Narrate the session, then pick a template</p>
                </div>
              </button>

              <button
                onClick={() => setPhase('letter-type')}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
                  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                  focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                  motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150"
                style={{
                  background: 'rgba(255,255,255,0.75)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                }}
              >
                <span className="text-[var(--blue)] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Dictate a letter</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Pick a letter type, then narrate it</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" className="text-[var(--text3)] shrink-0" aria-hidden>
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </>
        )}

        {/* Letter type selection */}
        {phase === 'letter-type' && (
          <>
            <p className="text-sm text-[var(--text2)]">Which letter would you like to dictate?</p>
            <div className="space-y-2.5">
              {LETTER_OPTIONS.map(opt => (
                <button
                  key={opt.type}
                  onClick={() => { setLetterType(opt.type); setPhase('idle') }}
                  className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
                    text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                    focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                    motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150"
                  style={{
                    background: 'rgba(255,255,255,0.75)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                  }}
                >
                  <span className="text-[var(--blue)] shrink-0">{opt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{opt.title}</p>
                    <p className="text-xs text-[var(--text3)] mt-0.5">{opt.description}</p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" className="text-[var(--text3)] shrink-0" aria-hidden>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              ))}
            </div>
            <button onClick={() => setPhase('choice')} className="text-xs text-[var(--text3)] hover:text-[var(--text)] transition-colors">
              ← Back
            </button>
          </>
        )}

        {phase === 'idle' && (
          <>
            {letterType ? (
              <>
                <p className="text-sm text-[var(--text2)]">
                  Dictating a <span className="font-semibold text-[var(--text)]">{selectedLabel}</span>. Speak these points clearly so they appear in the letter:
                </p>
                <ul className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-1.5">
                  {LETTER_GUIDE[letterType].map((pt, i) => (
                    <li key={i} className="flex gap-2 text-sm text-[var(--text2)]">
                      <span className="text-[var(--blue)] shrink-0">•</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--text2)]">
                  Narrate your note. Speak clearly and cover these topics so the AI can populate the note fully:
                </p>
                <ul className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-1.5">
                  {NOTE_GUIDE.map((pt, i) => (
                    <li key={i} className="flex gap-2 text-sm text-[var(--text2)]">
                      <span className="text-[#10b981] shrink-0">•</span>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Button onClick={handleStart} variant="primary" className="w-full">
              Start dictating
            </Button>
            <button
              onClick={() => setPhase(letterType ? 'letter-type' : 'choice')}
              className="text-xs text-[var(--text3)] hover:text-[var(--text)] transition-colors"
            >
              ← Back
            </button>
          </>
        )}

        {phase === 'recording' && (
          <div className="text-center py-2 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-2xl font-mono font-semibold text-[var(--text)]">
                {formatDuration(duration)}
              </span>
            </div>
            <p className="text-sm text-[var(--text3)]">
              {letterType ? `Dictating your ${selectedLabel?.toLowerCase()}…` : 'Dictating…'}
            </p>
            {audioSavedMin > 0 && (
              <p className="text-xs text-[#10b981] font-medium">~{audioSavedMin} min of audio safely captured</p>
            )}
            {transcribedMin > 0 && (
              <p className="text-xs text-[var(--text3)]">~{transcribedMin} min transcribed</p>
            )}
            {failures > 0 && (
              <p className="text-xs text-[var(--danger)] font-medium">⚠ {failures} segment(s) couldn&apos;t transcribe{lastError ? ` — ${lastError}` : ''}. Audio is saved — you can retry later.</p>
            )}
            {audioError && (
              <p className="text-xs text-[var(--danger)] font-medium">⚠ {audioError}</p>
            )}
            {draftError && (
              <p className="text-xs text-[var(--danger)] font-medium">⚠ {draftError}</p>
            )}
            <ul className="text-left rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-1.5">
              {(letterType ? LETTER_GUIDE[letterType] : NOTE_GUIDE).map((pt, i) => (
                <li key={i} className="flex gap-2 text-xs text-[var(--text2)]">
                  <span className={`${letterType ? 'text-[var(--blue)]' : 'text-[#10b981]'} shrink-0`}>•</span>
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
            <Button onClick={doStop} variant="danger" className="w-full">
              Stop dictating
            </Button>
          </div>
        )}

        {phase === 'processing' && (
          <div className="text-center py-8">
            <svg width="28" height="28" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)] mx-auto mb-3" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
            </svg>
            <p className="text-sm text-[var(--text2)]">Finishing transcription…</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
