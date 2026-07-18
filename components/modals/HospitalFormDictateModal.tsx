'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useSegmentedRecorder } from '@/hooks/useSegmentedRecorder'
import { useAuth } from '@/hooks/useAuth'
import type { RecordingDefaults, HospitalFormDoc } from '@/types'

interface Props {
  open: boolean
  form: HospitalFormDoc | null
  onClose: () => void
  onTranscriptReady: (text: string, duration: number) => void
  onStartBlank: () => void
  recordingDefaults?: RecordingDefaults
  hasInterruptedDraft?: boolean
}

type Phase = 'choice' | 'idle' | 'recording' | 'processing'

// What to say aloud so the AI can fill the form's identifiers + entry.
const GUIDE: string[] = [
  'Patient surname and given name(s)',
  'UR / medical record number',
  'Date of birth and sex',
  'The clinical entry — assessment, findings, plan (use SOAP if you like)',
]

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function HospitalFormDictateModal({ open, form, onClose, onTranscriptReady, onStartBlank, recordingDefaults, hasInterruptedDraft }: Props) {
  const [phase, setPhase] = useState<Phase>('choice')
  const [interrupted, setInterrupted] = useState(false)
  const [autoStopped, setAutoStopped] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const { duration, audioSavedMin, transcribedMin, failures, lastError, audioError, draftError, start, stop, error: recError } = useSegmentedRecorder()
  const { user } = useAuth()

  const autoStopMinutes = recordingDefaults?.autoStop === false ? null : (recordingDefaults?.autoStopMinutes ?? 55)

  useEffect(() => { if (open) setInterrupted(!!hasInterruptedDraft) }, [open, hasInterruptedDraft])

  useEffect(() => {
    if (!open) {
      setPhase('choice'); setAutoStopped(false); setInterrupted(false); setPermError(null)
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
      if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null }
    }
  }, [open])

  async function doStop() {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null }
    setPhase('processing')
    const result = await stop()
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    onTranscriptReady(result.text, result.duration)
  }
  stopRef.current = doStop

  function handleCancelRecording() {
    if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null }
    stop().catch(() => {})
    onClose()
  }

  async function handleStart() {
    setPermError(null)
    if (!user || !form) { setPermError('Please sign in and try again.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      start(stream, { uid: user.uid, mode: 'dictation', letterType: `hospitalform:${form.formKey}` })
      setPhase('recording')
      if (autoStopMinutes !== null) {
        autoStopRef.current = setTimeout(() => { setAutoStopped(true); stopRef.current?.() }, autoStopMinutes * 60 * 1000)
      }
    } catch {
      setPermError('Microphone access denied. Please allow access and try again.')
    }
  }

  return (
    <Modal open={open} onClose={phase === 'recording' ? handleCancelRecording : onClose} title={form ? form.name : 'Hospital form'} maxWidth="md">
      <div className="px-5 pb-5 space-y-4">
        {interrupted && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">A previous recording was interrupted.</div>
        )}
        {autoStopped && autoStopMinutes !== null && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">Recording stopped automatically after {autoStopMinutes} minutes.</div>
        )}
        {(permError ?? recError) && <p className="text-sm text-[var(--danger)]">{permError ?? recError}</p>}

        {phase === 'choice' && (
          <>
            <p className="text-sm text-[var(--text2)]">Dictate the progress note, or open a blank form to type into.</p>
            <div className="space-y-2.5">
              <button
                onClick={() => setPhase('idle')}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40 text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)] focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none motion-safe:active:scale-[0.97] motion-safe:transition-all"
                style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}
              >
                <span className="text-[#10b981] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Dictate the note</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Narrate it — the form fills automatically</p>
                </div>
              </button>
              <button
                onClick={onStartBlank}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[var(--border)] text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)] focus:outline-none motion-safe:active:scale-[0.97] motion-safe:transition-all"
              >
                <span className="text-[var(--blue)] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Start blank</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Open the form and type it yourself</p>
                </div>
              </button>
            </div>
          </>
        )}

        {phase === 'idle' && (
          <>
            <p className="text-sm text-[var(--text2)]">Speak these points clearly so they land in the right place:</p>
            <ul className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-1.5">
              {GUIDE.map((pt, i) => (
                <li key={i} className="flex gap-2 text-sm text-[var(--text2)]"><span className="text-[#10b981] shrink-0">•</span><span>{pt}</span></li>
              ))}
            </ul>
            <Button onClick={handleStart} variant="primary" className="w-full">Start dictating</Button>
            <button onClick={() => setPhase('choice')} className="text-xs text-[var(--text3)] hover:text-[var(--text)] transition-colors">← Back</button>
          </>
        )}

        {phase === 'recording' && (
          <div className="text-center py-2 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-2xl font-mono font-semibold text-[var(--text)]">{formatDuration(duration)}</span>
            </div>
            <p className="text-sm text-[var(--text3)]">Dictating…</p>
            {audioSavedMin > 0 && <p className="text-xs text-[#10b981] font-medium">~{audioSavedMin} min of audio safely captured</p>}
            {transcribedMin > 0 && <p className="text-xs text-[var(--text3)]">~{transcribedMin} min transcribed</p>}
            {failures > 0 && <p className="text-xs text-[var(--danger)] font-medium">⚠ {failures} segment(s) couldn&apos;t transcribe{lastError ? ` — ${lastError}` : ''}. Audio is saved.</p>}
            {audioError && <p className="text-xs text-[var(--danger)] font-medium">⚠ {audioError}</p>}
            {draftError && <p className="text-xs text-[var(--danger)] font-medium">⚠ {draftError}</p>}
            <Button onClick={doStop} variant="danger" className="w-full">Stop dictating</Button>
          </div>
        )}

        {phase === 'processing' && (
          <div className="text-center py-8">
            <svg width="28" height="28" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)] mx-auto mb-3" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
            </svg>
            <p className="text-sm text-[var(--text2)]">Finishing transcription…</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
