'use client'

import { useEffect, useRef, useState } from 'react'
import RecordingWave from '@/components/capture/RecordingWave'
import { useSegmentedRecorder } from '@/hooks/useSegmentedRecorder'
import { useRecordingPiP } from '@/hooks/useRecordingPiP'
import { ProgressOverlay, FINISHING_TRANSCRIPT } from '@/components/ui/ProgressOverlay'
import type { RecordingDefaults } from '@/types'

// The one-tap recording screen. Reached from the FAB's Record button, which
// starts the microphone inside its own tap and hands the request here, so there
// is no "Start recording" press between a doctor and a consultation.
//
// It records; it does not decide what the transcript becomes. `onDone` hands the
// finished text to the Generate page's state machine, which is the only thing
// that turns a transcript into a note.

export interface QuickRecordResult {
  text: string
  duration: number
  draftId: string
}

interface Props {
  /** The getUserMedia promise, started inside the FAB's click so the user
   *  gesture is still alive when the browser prompts. */
  micRequest: Promise<MediaStream>
  uid: string
  recordingDefaults?: RecordingDefaults
  onDone: (result: QuickRecordResult) => void
  onClose: () => void
}

type Phase = 'starting' | 'recording' | 'processing' | 'error'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function QuickRecordOverlay({ micRequest, uid, recordingDefaults, onDone, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [autoStopped, setAutoStopped] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const {
    duration, audioSavedMin, transcribedMin, failures, lastError,
    audioError, draftError, micLost, start, stop, abort, error: recError,
  } = useSegmentedRecorder()
  const pip = useRecordingPiP()

  // Same default as the Record modal: null disables the cut-off entirely.
  const autoStopMinutes = recordingDefaults?.autoStop === false
    ? null
    : (recordingDefaults?.autoStopMinutes ?? 55)

  // Wait on the microphone the FAB asked for, then start.
  //
  // `cancelled` covers React's development double-mount: the first run is torn
  // down before the promise settles, and only the live run may start a recorder.
  // It deliberately does NOT stop the tracks - the second run is about to use
  // the same stream, and the FAB releases the microphone when it closes this.
  useEffect(() => {
    let cancelled = false

    micRequest.then(
      mic => {
        if (cancelled) return
        streamRef.current = mic
        setStream(mic)
        start(mic, { uid, mode: 'conversation' })
        setPhase('recording')
        void pip.prepare()
        if (autoStopMinutes !== null) {
          autoStopRef.current = setTimeout(() => {
            setAutoStopped(true)
            stopRef.current?.()
          }, autoStopMinutes * 60 * 1000)
        }
      },
      () => {
        if (cancelled) return
        setStartError('Microphone access denied. Please allow microphone access and try again.')
        setPhase('error')
      },
    )

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the floating window's HUD in step with the live recording.
  useEffect(() => {
    pip.setStatus({ seconds: duration, micLost, label: 'Recording session' })
  })

  function clearAutoStop() {
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current)
      autoStopRef.current = null
    }
  }

  function releaseMic() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  async function doStop() {
    clearAutoStop()
    setPhase('processing')
    pip.teardown()
    const result = await stop()
    releaseMic()
    onDone(result)
  }

  stopRef.current = doStop

  // Cancel abandons the recording without handing anything on. abort(), not
  // stop(): stop() flushes the audio in hand into a recovery draft, so a
  // cancelled mis-tap came back as an "Unnamed patient" row under a button that
  // says it discards the recording entirely. Segments already saved during a
  // long session do survive, which is what the copy below says once there are
  // any - a forty-minute recording ended by a stray tap must stay recoverable.
  function handleCancel() {
    clearAutoStop()
    pip.teardown()
    abort()
    releaseMic()
    onClose()
  }

  const problem = startError ?? recError

  // Not rendered inside the recording screen: this is the card the FAB holds up
  // through the navigation that follows, and showing it here rather than a
  // second spinner is what makes the handover invisible.
  if (phase === 'processing') return <ProgressOverlay label={FINISHING_TRANSCRIPT} />

  return (
    <div
      className="ln-glass ln-glass-modal fixed inset-0 z-[110] flex flex-col overflow-y-auto"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      role="status"
      aria-live="polite"
    >
      <div className="m-auto w-full max-w-sm px-6 py-4 text-center space-y-5">

        {phase === 'error' ? (
          <>
            <p className="text-base font-semibold text-[var(--text)]">Could not start recording</p>
            <p className="text-sm text-[var(--danger)]">{problem}</p>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-[var(--r)] bg-[var(--text)] text-white text-sm font-medium"
            >
              Close
            </button>
          </>
        ) : (
          <>
            {/* The consent gate the Record card puts before its Start button.
                There is no Start button here, so it stands next to Cancel,
                which undoes the recording completely. */}
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[var(--text)]">
                Confirm the patient has agreed to being recorded.
              </p>
              <p className="text-xs text-[var(--text3)]">
                {audioSavedMin > 0
                  ? `Cancel stops here. The ${audioSavedMin} min already saved stays recoverable.`
                  : 'Cancel discards this recording entirely.'}
              </p>
            </div>

            {/* The mic on the same emerald glass as the button that opened
                this, so the tap and what it started are one object. */}
            <div className="relative flex items-center justify-center h-[150px]">
              <span className="ln-record-ring absolute w-[150px] h-[150px] rounded-full" aria-hidden />
              <span className="ln-record-ring absolute w-[112px] h-[112px] rounded-full" style={{ animationDelay: '0.9s' }} aria-hidden />
              <span className="ln-glass ln-glass-fab relative z-0 w-[84px] h-[84px] rounded-full flex items-center justify-center text-white">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </span>
            </div>

            <RecordingWave stream={stream} lost={micLost} />

            <div className="flex justify-center">
              <div className="ln-glass ln-glass-fab-action z-0 inline-flex items-center gap-2 rounded-full px-4 py-2">
                <span className={`w-2.5 h-2.5 rounded-full motion-safe:animate-pulse ${micLost ? 'bg-amber-500' : 'bg-red-500'}`} />
                <span className="text-lg font-semibold tabular-nums text-[var(--text)]">{formatDuration(duration)}</span>
              </div>
            </div>

            <p className="text-xs text-[var(--text3)]">
              {phase === 'starting'
                ? 'Starting the microphone…'
                : micLost ? 'Paused - waiting for the microphone…' : 'Recording. Speak normally.'}
            </p>

            {/* Cancel · Stop · keep recording in another app. */}
            <div className="flex items-start justify-center gap-6 pt-1">
              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={handleCancel}
                  className="ln-glass ln-glass-fab-action z-0 w-14 h-14 rounded-full flex items-center justify-center text-[var(--text2)] motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                  aria-label="Cancel recording and discard it"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <span className="text-xs text-[var(--text3)]">Cancel</span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                <button
                  onClick={doStop}
                  disabled={phase !== 'recording'}
                  className="w-[68px] h-[68px] rounded-full flex items-center justify-center bg-[var(--danger)] text-white
                             disabled:opacity-50 motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                  style={{ boxShadow: '0 6px 20px rgba(239,68,68,.28)' }}
                  aria-label="Stop recording and write the note"
                >
                  <span className="w-6 h-6 rounded-[6px] bg-white" />
                </button>
                <span className="text-xs font-medium text-[var(--text2)]">Stop</span>
              </div>

              <div className="flex flex-col items-center gap-1.5">
                {/* A page driving an active picture-in-picture video is not
                    treated as backgrounded, so the microphone survives the
                    doctor switching apps. Opened only on this press - the
                    browser requires a gesture. */}
                <button
                  onClick={() => { void (pip.active ? pip.exit() : pip.enter()) }}
                  disabled={!pip.supported || phase !== 'recording'}
                  className="ln-glass ln-glass-fab-action z-0 w-14 h-14 rounded-full flex items-center justify-center text-[var(--text2)]
                             disabled:opacity-40 motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                  aria-label={pip.active ? 'Close the floating window' : 'Keep recording while I use another app'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
                  </svg>
                </button>
                <span className="text-xs text-[var(--text3)]">
                  {pip.supported ? (pip.active ? 'Window on' : 'Multitask') : 'Split-screen'}
                </span>
              </div>
            </div>

            {/* What the recorder actually knows. None of this is decoration: it
                is how a doctor can tell a long session is being kept. */}
            <div className="space-y-1.5 pt-1">
              {autoStopped && autoStopMinutes !== null && (
                <p className="text-xs text-[var(--text2)]">Recording stopped automatically after {autoStopMinutes} minutes.</p>
              )}
              {micLost && (
                <p className="text-xs text-amber-700 text-left rounded-[var(--r)] bg-amber-50 border border-amber-200 px-3 py-2">
                  The microphone was interrupted (e.g. a phone call, or the screen was locked). Everything recorded so far is saved as a recoverable draft. Recording resumes automatically when the mic is free - or tap Stop to finish now.
                </p>
              )}
              {audioSavedMin > 0 && (
                <p className="text-xs text-[#10b981] font-medium">~{audioSavedMin} min of audio safely captured</p>
              )}
              {transcribedMin > 0 && <p className="text-xs text-[var(--text3)]">~{transcribedMin} min transcribed</p>}
              {failures > 0 && (
                <p className="text-xs text-[var(--danger)] font-medium">
                  ⚠ {failures} segment(s) couldn&apos;t transcribe{lastError ? ` - ${lastError}` : ''}. Audio is saved - you can retry later.
                </p>
              )}
              {audioError && <p className="text-xs text-[var(--danger)] font-medium">⚠ {audioError}</p>}
              {draftError && <p className="text-xs text-[var(--danger)] font-medium">⚠ {draftError}</p>}
              {pip.error && <p className="text-[11px] text-[var(--danger)]">{pip.error}</p>}
              {problem && <p className="text-xs text-[var(--danger)]">{problem}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
