'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useSegmentedRecorder } from '@/hooks/useSegmentedRecorder'
import { useAuth } from '@/hooks/useAuth'
import type { RecordingDefaults } from '@/types'

interface RecordModalProps {
  open: boolean
  onClose: () => void
  onTranscriptReady: (text: string, duration: number) => void
  recordingDefaults?: RecordingDefaults
}

type SubMode = 'inperson' | 'telehealth'
type Phase = 'idle' | 'recording' | 'processing'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RecordModal({ open, onClose, onTranscriptReady, recordingDefaults }: RecordModalProps) {
  const [subMode, setSubMode] = useState<SubMode>('inperson')
  const [phase, setPhase] = useState<Phase>('idle')
  const [interrupted, setInterrupted] = useState(false)
  const [autoStopped, setAutoStopped] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const { duration, audioSavedMin, transcribedMin, failures, lastError, audioError, start, stop, error: recError } = useSegmentedRecorder()
  const { user } = useAuth()

  // null means auto-stop is disabled; otherwise stop after this many minutes
  const autoStopMinutes = recordingDefaults?.autoStop === false
    ? null
    : (recordingDefaults?.autoStopMinutes ?? 55)

  useEffect(() => {
    if (open && localStorage.getItem('ln_recording_interrupted') === '1') {
      setInterrupted(true)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setPhase('idle')
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
    localStorage.removeItem('ln_recording_interrupted')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // Hand the finished transcript to the parent. Do NOT call onClose() here —
    // the parent closes this modal by flipping its phase.
    onTranscriptReady(result.text, result.duration)
  }

  // Keep stopRef current so the auto-stop timeout always calls the latest version
  stopRef.current = doStop

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
      localStorage.setItem('ln_recording_interrupted', '1')
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
    <Modal open={open} onClose={phase === 'recording' ? () => {} : onClose} title="Record Session">
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
            <div className="flex rounded-lg bg-[var(--bg)] p-1 gap-1">
              {(['inperson', 'telehealth'] as SubMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setSubMode(m)}
                  className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors
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
            <Button onClick={handleStart} variant="primary" className="w-full">
              Start recording
            </Button>
          </>
        )}

        {phase === 'recording' && (
          <div className="text-center py-4 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-2xl font-mono font-semibold text-[var(--text)]">
                {formatDuration(duration)}
              </span>
            </div>
            <p className="text-sm text-[var(--text3)]">Recording in progress…</p>
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
