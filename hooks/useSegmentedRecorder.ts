'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { getGroqKey } from '@/lib/utils'
import { saveTranscriptDraft } from '@/lib/firestore/transcriptDrafts'

// Each recorder cycle produces an independently-valid audio file (~4 min), which
// is transcribed on its own and appended to a durable Firestore draft the moment
// it finishes. Because the server only ever sees one short segment per request,
// recordings of ANY length transcribe within the 60s serverless limit, and an
// interruption at any point keeps everything transcribed so far.
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

export function useSegmentedRecorder() {
  const [isRecording, setIsRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [minutesSaved, setMinutesSaved] = useState(0)
  const [pending, setPending] = useState(0)
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

  useEffect(() => {
    function onVisibility() {
      if (!streamRef.current) return
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
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

  async function transcribeSegment(blob: Blob): Promise<string | null> {
    const opts = optsRef.current
    if (!opts) return null
    for (let attempt = 0; ; attempt++) {
      try {
        const fd = new FormData()
        fd.append('audio', blob, 'segment')
        fd.append('mimeType', mimeRef.current)
        fd.append('uid', opts.uid)
        const headers: Record<string, string> = {}
        const gk = getGroqKey()
        if (gk) headers['x-groq-key'] = gk
        const res = await fetch('/api/transcribe', { method: 'POST', headers, body: fd })
        if (!res.ok) throw new Error(`http ${res.status}`)
        return ((await res.json()) as { text: string }).text
      } catch (err) {
        if (attempt >= 2) return null
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
  }

  const drainQueue = useCallback(async () => {
    if (workingRef.current) return
    workingRef.current = true
    try {
      while (queueRef.current.length > 0) {
        setPending(queueRef.current.length)
        const seg = queueRef.current.shift()!
        const text = await transcribeSegment(seg)
        if (text && text.trim()) {
          textRef.current = `${textRef.current} ${text.trim()}`.trim()
        }
        setMinutesSaved((m) => m + SEGMENT_MINUTES)
        const opts = optsRef.current
        if (opts) {
          await saveTranscriptDraft(opts.uid, {
            text: textRef.current,
            mode: opts.mode,
            letterType: opts.letterType ?? null,
            durationSec: Math.floor((Date.now() - startTimeRef.current) / 1000),
          }).catch(() => {})
        }
        setPending(queueRef.current.length)
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
        // Ignore near-empty segments (e.g. an immediate stop) that carry no audio
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
    streamRef.current = stream
    optsRef.current = opts
    textRef.current = ''
    queueRef.current = []
    setMinutesSaved(0)
    setPending(0)
    setDuration(0)
    mimeRef.current = pickMime()
    startTimeRef.current = Date.now()
    startSegmentRecorder()
    setIsRecording(true)
    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    // Every cycle: close the current segment (its onstop enqueues it) and open
    // a fresh recorder so the audio keeps flowing with only a sub-frame gap.
    cycleRef.current = setInterval(() => {
      const old = recorderRef.current
      if (old && old.state !== 'inactive') old.stop()
      startSegmentRecorder()
    }, SEGMENT_MS)
  }, [drainQueue])

  const stop = useCallback(async (): Promise<StopResult> => {
    if (cycleRef.current) { clearInterval(cycleRef.current); cycleRef.current = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const dur = Math.floor((Date.now() - startTimeRef.current) / 1000)

    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      // The assigned onstop (enqueue) runs first; this listener resolves after it.
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true })
        rec.stop()
      })
    }
    // Wait for the final segment (and any still in flight) to finish transcribing.
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
  }, [])

  return { isRecording, duration, minutesSaved, pending, error, start, stop }
}
