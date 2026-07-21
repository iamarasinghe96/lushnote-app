'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { getGroqKey, getGeminiKey } from '@/lib/utils'
import { saveTranscriptDraft, type SegmentLogEntry } from '@/lib/firestore/transcriptDrafts'
import { uploadRecordingSegment } from '@/lib/storage'

// Each recorder cycle produces an independently-valid audio file (~4 min). Two
// things happen to every segment the moment it is captured:
//   1. Its AUDIO is uploaded to Storage (durable) — so a session is NEVER lost,
//      even if transcription fails completely; the audio can be re-transcribed.
//   2. It is transcribed and appended to a Firestore draft (best effort).
// The counters report the truth: audio captured vs. actually transcribed, and a
// failure is surfaced immediately instead of being masked.
const SEGMENT_MS = 4 * 60 * 1000
const SEGMENT_MINUTES = 4

interface StartOpts {
  uid: string
  mode: string
  letterType?: string | null
}

interface StopResult {
  text: string
  duration: number
}

interface SegResult {
  ok: boolean
  text?: string
  provider?: string
  error?: string
  ms: number
}

// Screen Wake Lock — mobile OSes (and installed PWAs) suspend the page when the
// screen locks, which stops the MediaRecorder so only the audio captured while
// the screen was on gets transcribed. Holding a wake lock keeps the screen from
// auto-locking during a recording. It is auto-released when the tab is hidden,
// so it must be re-acquired whenever the app returns to the foreground.
interface WakeLockSentinelLike { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void }
interface WakeLockLike { request: (type: 'screen') => Promise<WakeLockSentinelLike> }

function shortErr(e?: string): string {
  if (!e) return 'unknown error'
  return e.length > 80 ? e.slice(0, 80) : e
}

export function useSegmentedRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioSavedMin, setAudioSavedMin] = useState(0)
  const [transcribedMin, setTranscribedMin] = useState(0)
  const [failures, setFailures] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const mimeRef = useRef<string>('')
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queueRef = useRef<Blob[]>([])
  const workingRef = useRef(false)
  const textRef = useRef('')
  const optsRef = useRef<StartOpts | null>(null)
  const sessionIdRef = useRef<string>('')
  const segNoRef = useRef(0)
  const logRef = useRef<SegmentLogEntry[]>([])
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)

  const acquireWakeLock = useCallback(async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
      if (!wl || wakeLockRef.current || document.visibilityState !== 'visible') return
      const sentinel = await wl.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener?.('release', () => { if (wakeLockRef.current === sentinel) wakeLockRef.current = null })
    } catch { /* denied / unsupported — best effort; recording still runs while visible */ }
  }, [])
  const acquireRef = useRef(acquireWakeLock)
  acquireRef.current = acquireWakeLock

  const releaseWakeLock = useCallback(() => {
    const s = wakeLockRef.current
    wakeLockRef.current = null
    if (s) { try { void s.release() } catch { /* already gone */ } }
  }, [])

  useEffect(() => {
    return () => {
      if (cycleRef.current) clearInterval(cycleRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
      releaseWakeLock()
    }
  }, [releaseWakeLock])

  useEffect(() => {
    function onVisibility() {
      if (!streamRef.current) return
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
      // The wake lock drops when the app is backgrounded; re-take it the moment
      // the doctor brings the app back so the next screen-off keeps recording.
      if (document.visibilityState === 'visible') void acquireRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  function pickMime(): string {
    if (typeof MediaRecorder === 'undefined') return 'audio/webm'
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
    return 'audio/mp4'
  }

  async function transcribeSegment(blob: Blob, segIndex: number): Promise<SegResult> {
    const opts = optsRef.current
    const startedAt = Date.now()
    if (!opts) return { ok: false, error: 'no-session', ms: 0 }
    for (let attempt = 0; ; attempt++) {
      try {
        const fd = new FormData()
        fd.append('audio', blob, 'segment')
        fd.append('mimeType', mimeRef.current)
        fd.append('uid', opts.uid)
        fd.append('segIndex', String(segIndex))
        const headers: Record<string, string> = {}
        const gk = getGroqKey()
        if (gk) headers['x-groq-key'] = gk
        const gemk = getGeminiKey()
        if (gemk) headers['x-gemini-key'] = gemk
        const res = await fetch('/api/transcribe', { method: 'POST', headers, body: fd })
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(`${res.status}${data.error ? ' ' + data.error : ''}`)
        }
        const data = (await res.json()) as { text: string; provider?: string }
        return { ok: true, text: data.text, provider: data.provider, ms: Date.now() - startedAt }
      } catch (err) {
        if (attempt >= 2) {
          return { ok: false, error: err instanceof Error ? err.message : 'failed', ms: Date.now() - startedAt }
        }
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
  }

  const drainQueue = useCallback(async () => {
    if (workingRef.current) return
    workingRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const seg = queueRef.current.shift()!
        const segNo = ++segNoRef.current
        const opts = optsRef.current
        if (!opts) break

        // 1. Save the audio durably FIRST — this is the guarantee that a session
        //    can never be lost, independent of whether transcription works.
        let audioSaved = false
        try {
          await uploadRecordingSegment(opts.uid, sessionIdRef.current, segNo, seg, mimeRef.current)
          audioSaved = true
          setAudioSavedMin((m) => m + SEGMENT_MINUTES)
          setAudioError(null)
        } catch {
          setAudioError('Could not save audio to the cloud. Check your connection — your recording may not be protected.')
        }

        // 2. Transcribe (best effort).
        const r = await transcribeSegment(seg, segNo)
        if (r.ok && r.text && r.text.trim()) {
          textRef.current = `${textRef.current} ${r.text.trim()}`.trim()
          setTranscribedMin((m) => m + SEGMENT_MINUTES)
        } else if (!r.ok) {
          setFailures((f) => f + 1)
          setLastError(shortErr(r.error))
        }

        logRef.current.push({
          seg: segNo,
          ok: r.ok,
          provider: audioSaved ? r.provider : (r.provider ? r.provider + ' (audio-unsaved)' : 'audio-unsaved'),
          chars: r.text ? r.text.length : 0,
          ms: r.ms,
          error: r.error,
        })

        // The recovery draft is the ONLY durable copy of the transcript until a
        // note is saved. A failed write here (e.g. a rules/permission problem)
        // must be visible, not swallowed — surface the Firebase error code so
        // the recording screen shows exactly what went wrong.
        try {
          await saveTranscriptDraft(opts.uid, {
            text: textRef.current,
            mode: opts.mode,
            letterType: opts.letterType ?? null,
            durationSec: Math.floor((Date.now() - startTimeRef.current) / 1000),
            segmentLog: logRef.current.slice(-80),
          })
          setDraftError(null)
        } catch (err) {
          const code = (err as { code?: string })?.code
            ?? (err instanceof Error ? err.message : 'unknown')
          setDraftError(`Recovery draft could not be saved (${shortErr(String(code))}). If this recording is interrupted, the transcript will NOT be recoverable.`)
        }
      }
    } finally {
      workingRef.current = false
    }
  }, [])

  function startSegmentRecorder() {
    const stream = streamRef.current
    if (!stream) return
    const rec = new MediaRecorder(stream, { mimeType: mimeRef.current, audioBitsPerSecond: 48000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    rec.onstop = () => {
      if (chunks.length) {
        const blob = new Blob(chunks, { type: mimeRef.current })
        if (blob.size > 2000) {
          queueRef.current.push(blob)
          drainQueue()
        }
      }
    }
    rec.onerror = () => setError('Recording error occurred')
    rec.start()
    recorderRef.current = rec
  }

  const start = useCallback((stream: MediaStream, opts: StartOpts) => {
    setError(null)
    setAudioError(null)
    setLastError(null)
    setDraftError(null)
    streamRef.current = stream
    optsRef.current = opts
    sessionIdRef.current = crypto.randomUUID()
    textRef.current = ''
    queueRef.current = []
    logRef.current = []
    segNoRef.current = 0
    setAudioSavedMin(0)
    setTranscribedMin(0)
    setFailures(0)
    setDuration(0)
    mimeRef.current = pickMime()
    startTimeRef.current = Date.now()
    startSegmentRecorder()
    setIsRecording(true)
    void acquireWakeLock()
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    cycleRef.current = setInterval(() => {
      const old = recorderRef.current
      if (old && old.state !== 'inactive') old.stop()
      startSegmentRecorder()
    }, SEGMENT_MS)
  }, [drainQueue, acquireWakeLock])

  const stop = useCallback(async (): Promise<StopResult> => {
    if (cycleRef.current) { clearInterval(cycleRef.current); cycleRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    releaseWakeLock()
    const dur = Math.floor((Date.now() - startTimeRef.current) / 1000)

    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        rec.stop()
      })
    }
    while (queueRef.current.length > 0 || workingRef.current) {
      await new Promise((r) => setTimeout(r, 300))
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    recorderRef.current = null
    setIsRecording(false)
    return { text: textRef.current, duration: dur }
  }, [releaseWakeLock])

  return { isRecording, duration, audioSavedMin, transcribedMin, failures, lastError, audioError, draftError, error, start, stop }
}
