'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useSegmentedRecorder } from '@/hooks/useSegmentedRecorder'
import { useRecordingPiP } from '@/hooks/useRecordingPiP'
import { useAuth } from '@/hooks/useAuth'
import type { RecordingDefaults } from '@/types'

interface RecordModalProps {
  open: boolean
  onClose: () => void
  onTranscriptReady: (text: string, duration: number, draftId: string) => void
  recordingDefaults?: RecordingDefaults
  // Whether a genuinely recoverable transcript draft exists in Firestore right
  // now (the same signal that drives the Generate-page recovery banner and
  // the Patients "Unnamed patient" row) — NOT a localStorage tripwire that
  // just remembers "a recording once started." Only real, unresolved data
  // should trigger the "previous recording was interrupted" warning below.
  hasInterruptedDraft?: boolean
}

type SubMode = 'inperson' | 'telehealth'
type Phase = 'idle' | 'recording' | 'processing'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RecordModal({ open, onClose, onTranscriptReady, recordingDefaults, hasInterruptedDraft }: RecordModalProps) {
  const [subMode, setSubMode] = useState<SubMode>('inperson')
  const [phase, setPhase] = useState<Phase>('idle')
  const [interrupted, setInterrupted] = useState(false)
  const [autoStopped, setAutoStopped] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const { duration, audioSavedMin, transcribedMin, failures, lastError, audioError, draftError, micLost, start, stop, error: recError } = useSegmentedRecorder()
  const pip = useRecordingPiP()
  const { user } = useAuth()

  // null means auto-stop is disabled; otherwise stop after this many minutes
  const autoStopMinutes = recordingDefaults?.autoStop === false
    ? null
    : (recordingDefaults?.autoStopMinutes ?? 55)

  useEffect(() => {
    if (open) setInterrupted(!!hasInterruptedDraft)
  }, [open, hasInterruptedDraft])

  useEffect(() => {
    if (!open) {
      setPhase('idle')
      setAutoStopped(false)
      setInterrupted(false)
      setPermError(null)
      pip.teardown()
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

  // Build the floating-window surface as soon as the pre-record screen shows.
  // It must be ready and playing BEFORE the tap: entering picture-in-picture is
  // only permitted inside a user gesture, and iOS ends that gesture at the first
  // await — so nothing may be prepared after the doctor taps.
  useEffect(() => {
    if (open && phase === 'idle') void pip.prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase])

  // Keep the floating window's HUD in step with the live recording.
  useEffect(() => {
    pip.setStatus({ seconds: duration, micLost, label: 'Recording session' })
  })

  async function doStop() {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
    setPhase('processing')
    pip.teardown()
    const result = await stop()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // Hand the finished transcript to the parent. Do NOT call onClose() here —
    // the parent closes this modal by flipping its phase.
    onTranscriptReady(result.text, result.duration, result.draftId)
  }

  // Keep stopRef current so the auto-stop timeout always calls the latest version
  stopRef.current = doStop

  // The X while recording: abort the session and go back WITHOUT handing the
  // transcript on to the naming step. stop() tears down the recorder loop and
  // mic stream; we fire it and close immediately so the tap feels instant.
  //
  // Reachable ONLY from the X now. The backdrop and Escape used to land here
  // too, which meant a stray click during a consultation ended the recording —
  // and under 4 minutes nothing has reached the recovery draft yet, so it ended
  // it with nothing kept. Those two are gestures a doctor makes by accident
  // while a session is live; the X is not. See `dismissible` on Modal.
  //
  // Segments already written to the Firestore recovery draft are left intact,
  // so a deliberate abort of a long recording is still recoverable.
  function handleCancelRecording() {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
    pip.teardown()
    stop().catch(() => {})
    onClose()
  }

  async function handleStart() {
    setPermError(null)
    if (!user) { setPermError('Please sign in and try again.'); return }
    try {
      const stream = subMode === 'telehealth'
        ? await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { displaySurface: 'browser' } })
        : await navigator.mediaDevices.getUserMedia({ audio: true })

      // For telehealth, the user must tick "Share tab audio" in the picker.
      // If they didn't, the stream has no audio tracks — warn immediately.
      if (subMode === 'telehealth' && stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(t => t.stop())
        setPermError('No audio detected. When sharing your tab, tick "Share tab audio" (Chrome) or "Share audio" (Edge) in the picker.')
        return
      }

      streamRef.current = stream
      // getDisplayMedia returns video + audio tracks; MediaRecorder is configured
      // for audio-only. Build an audio-only stream so the recorder doesn't reject it.
      const audioOnlyStream = subMode === 'telehealth'
        ? new MediaStream(stream.getAudioTracks())
        : stream
      start(audioOnlyStream, { uid: user.uid, mode: 'conversation' })
      setPhase('recording')
      if (autoStopMinutes !== null) {
        autoStopRef.current = setTimeout(() => {
          setAutoStopped(true)
          stopRef.current?.()
        }, autoStopMinutes * 60 * 1000)
      }
    } catch {
      setPermError(
        subMode === 'telehealth'
          ? 'Screen share was cancelled or denied. Click "Start recording" and select the tab to share.'
          : 'Microphone access denied. Please allow microphone access and try again.'
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={phase === 'recording' ? handleCancelRecording : onClose}
      dismissible={phase !== 'recording'}
      title="Record Session"
    >
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

        {phase === 'idle' && (
          <>
            <div className="flex rounded-[var(--r)] bg-[var(--bg)] p-1 gap-1">
              {(['inperson', 'telehealth'] as SubMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setSubMode(m)}
                  className={`flex-1 py-1.5 rounded-[var(--r-sm)] text-sm font-medium transition-colors
                    ${subMode === m
                      ? 'bg-[#10b981] text-white shadow-sm'
                      : 'text-[var(--text2)] hover:text-[var(--text)]'
                    }`}
                >
                  {m === 'inperson' ? 'In-person' : 'Telehealth'}
                </button>
              ))}
            </div>
            <p className="text-sm text-[var(--text2)]">
              {subMode === 'telehealth'
                ? 'Share the browser tab your telehealth call is in. When the picker appears, select the tab and tick "Share tab audio".'
                : 'Your microphone will be recorded.'}
            </p>
            <div className="rounded-[var(--r)] bg-red-100 border border-red-500 px-3 py-2.5 motion-safe:animate-pulse">
              <p className="text-sm text-red-700 leading-relaxed font-semibold text-center">
                ⚠️ Please obtain the patient&rsquo;s consent before recording this session.
              </p>
            </div>
            <Button onClick={handleStart} variant="primary" className="w-full">
              Start recording
            </Button>
          </>
        )}

        {phase === 'recording' && (
          <div className="text-center py-4 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${micLost ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="text-2xl font-mono font-semibold text-[var(--text)]">
                {formatDuration(duration)}
              </span>
            </div>
            <p className="text-sm text-[var(--text3)]">{micLost ? 'Paused — waiting for the microphone…' : 'Recording in progress…'}</p>
            {/* Multitask: a page driving an active picture-in-picture video isn't
                treated as backgrounded, so the microphone survives. Opened only
                on this press — the browser requires a gesture, and an unasked-for
                floating window is worse than none. */}
            {pip.supported ? (
              pip.active ? (
                <div className="rounded-lg bg-[#10b981]/10 border border-[#10b981]/40 px-3 py-2.5 text-left space-y-2">
                  <p className="text-xs text-[#059669] font-medium">
                    Floating window on — you can switch apps now. Keep the small window on screen.
                  </p>
                  <button
                    onClick={() => { void pip.exit() }}
                    className="text-xs text-[var(--text2)] underline hover:text-[var(--text)] transition-colors"
                  >
                    Close floating window
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { void pip.enter() }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-[var(--r)]
                             border border-[#10b981]/50 text-[#059669] text-sm font-medium
                             hover:bg-[#10b981]/10 active:scale-[0.98] transition-all"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="2" y="4" width="20" height="16" rx="2"/>
                    <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none"/>
                  </svg>
                  Keep recording while I use another app
                </button>
              )
            ) : !micLost && (
              <p className="text-[11px] text-[var(--text3)]">
                To use another app while recording, open it in <span className="font-medium text-[var(--text2)]">split-screen</span> so LushNote stays visible.
              </p>
            )}
            {pip.error && <p className="text-[11px] text-[var(--danger)]">{pip.error}</p>}
            {micLost && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 text-left">
                The microphone was interrupted (e.g. a phone call, or the screen was locked). Everything recorded so far is saved as a recoverable draft. Recording resumes automatically when the mic is free — or tap Stop to finish now.
              </div>
            )}
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
            <Button onClick={doStop} variant="danger" className="w-full">
              Stop recording
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
