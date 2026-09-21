'use client'

import { useEffect, useRef, useState } from 'react'
import { rmsLevel } from '@/lib/micLevel'

// Is anyone still talking?
//
// The same AnalyserNode trick the recording meter uses, reading the same stream
// the MediaRecorder has - reusing `rmsLevel` rather than a second copy of the
// arithmetic. It answers one question: when did someone last speak, and how
// long has it been quiet since.
//
// It FAILS OPEN, and that is the whole safety story. Any browser without an
// AudioContext, any error building the graph, and `available` stays false -
// which makes evaluateSessionEnd return 'listening' forever. No detector means
// no automatic stop, never a wrong one.

export interface VoiceActivitySnapshot {
  available: boolean
  lastSpeechAt: number | null
  silenceMs: number
}

/** 100ms is fast enough to cancel a countdown the instant someone speaks, and
 *  slow enough to cost nothing next to the recorder and the upload queue. */
const SAMPLE_MS = 100

/** A room is never digitally silent. The floor tracks the quietest recent level
 *  so a humming ward does not read as constant speech, and speech has to clear
 *  it by a wide margin. */
const FLOOR_RISE = 1.02
const FLOOR_CREEP = 0.0004
const SPEECH_OVER_FLOOR = 3
const SPEECH_ABSOLUTE_MIN = 0.012

export function useVoiceActivity(stream: MediaStream | null, enabled: boolean) {
  const snapshotRef = useRef<VoiceActivitySnapshot>({
    available: false, lastSpeechAt: null, silenceMs: 0,
  })
  // Bumped only when speech RESUMES after a quiet spell, so a countdown can be
  // cancelled at once without this re-rendering ten times a second.
  const [speechResumedAt, setSpeechResumedAt] = useState(0)

  useEffect(() => {
    if (!enabled || !stream) {
      snapshotRef.current = { available: false, lastSpeechAt: null, silenceMs: 0 }
      return
    }

    const Ctx = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return

    let ctx: AudioContext
    let source: MediaStreamAudioSourceNode
    let analyser: AnalyserNode
    try {
      ctx = new Ctx()
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      // To the analyser and nothing else. Routing a microphone to the speakers
      // in a consulting room is feedback.
      source.connect(analyser)
    } catch {
      // Leaves `available` false, which is the reason to keep recording.
      return
    }
    void ctx.resume().catch(() => {})

    const bytes = new Uint8Array(analyser.fftSize)
    let floor = 0.02
    let lastSpeechAt = Date.now()
    let quietSince: number | null = null
    snapshotRef.current = { available: true, lastSpeechAt, silenceMs: 0 }

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(bytes)
      const level = rmsLevel(bytes)
      const now = Date.now()

      // Drops straight to a new quiet level, climbs back only slowly, so the
      // threshold follows the room rather than the loudest thing in it.
      floor = level < floor ? level : Math.min(floor * FLOOR_RISE + FLOOR_CREEP, level)

      const speaking = level > Math.max(floor * SPEECH_OVER_FLOOR, SPEECH_ABSOLUTE_MIN)
      if (speaking) {
        const wasQuiet = quietSince !== null && now - quietSince > 1_000
        lastSpeechAt = now
        quietSince = null
        if (wasQuiet) setSpeechResumedAt(now)
      } else if (quietSince === null) {
        quietSince = now
      }

      snapshotRef.current = {
        available: true,
        lastSpeechAt,
        silenceMs: quietSince === null ? 0 : now - quietSince,
      }
    }, SAMPLE_MS)

    return () => {
      clearInterval(timer)
      snapshotRef.current = { available: false, lastSpeechAt: null, silenceMs: 0 }
      try { source.disconnect() } catch { /* already gone */ }
      void ctx.close().catch(() => {})
    }
  }, [stream, enabled])

  return { snapshotRef, speechResumedAt }
}
