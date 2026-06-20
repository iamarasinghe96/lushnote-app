'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useRecorder } from '@/hooks/useRecorder'
import type { RecordingDefaults } from '@/types'

interface DictateModalProps {
  open: boolean
  onClose: () => void
  onAudioReady: (blob: Blob, mimeType: string, duration: number, chunks: Blob[]) => void
  recordingDefaults?: RecordingDefaults
}

type Phase = 'idle' | 'recording' | 'processing'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function DictateModal({ open, onClose, onAudioReady, recordingDefaults }: DictateModalProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [interrupted, setInterrupted] = useState(false)
  const [autoStopped, setAutoStopped] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const { duration, startRecording, stopRecording, error: recError } = useRecorder()

  const autoStopMinutes = recordingDefaults?.autoStop ? (recordingDefaults.autoStopMinutes ?? 55) : 55

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
    const result = await stopRecording()
    localStorage.removeItem('ln_recording_interrupted')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    onAudioReady(result.blob, result.mimeType, result.duration, result.chunks)
    onClose()
  }

  stopRef.current = doStop

  async function handleStart() {
    setPermError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      localStorage.setItem('ln_recording_interrupted', '1')
      startRecording(stream)
      setPhase('recording')
      autoStopRef.current = setTimeout(() => {
        setAutoStopped(true)
        stopRef.current?.()
      }, autoStopMinutes * 60 * 1000)
    } catch {
      setPermError('Microphone access denied. Please allow access and try again.')
    }
  }

  return (
    <Modal open={open} onClose={phase === 'recording' ? () => {} : onClose} title="Dictate Note">
      <div className="px-5 pb-5 space-y-4">
        {interrupted && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            A previous recording was interrupted.
          </div>
        )}
        {autoStopped && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            Recording stopped automatically after {autoStopMinutes} minutes.
          </div>
        )}
        {(permError ?? recError) && (
          <p className="text-sm text-[var(--danger)]">{permError ?? recError}</p>
        )}

        {phase === 'idle' && (
          <>
            <p className="text-sm text-[var(--text2)]">
              Narrate your note. Speak clearly and include all relevant clinical detail.
            </p>
            <Button onClick={handleStart} variant="primary" className="w-full">
              Start dictating
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
            <p className="text-sm text-[var(--text3)]">Dictating…</p>
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
            <p className="text-sm text-[var(--text2)]">Processing recording…</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
