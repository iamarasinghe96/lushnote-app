'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useVoiceActivity } from '@/hooks/useVoiceActivity'
import {
  evaluateSessionEnd, sessionEndReducer, COUNTDOWN_MS, SILENCE_MS,
  type SessionEndState,
} from '@/lib/sessionEnd'

// Wiring the detector to the recording.
//
// Everything that DECIDES anything lives in lib/sessionEnd.ts, where it is
// pure and tested. This holds the clocks, the stream and the one piece of
// bookkeeping that cannot be pure: which candidate has already been answered,
// so "Keep recording" is not undone a second later by the same goodbye.

/** Cut a segment early once it has been quiet this long, so the tail of the
 *  conversation reaches the detector instead of sitting in a MediaRecorder for
 *  another four minutes. Shorter than SILENCE_MS on purpose: by the time the
 *  silence is long enough to matter, the text is already back. */
const FLUSH_AFTER_SILENCE_MS = 12_000

interface Options {
  enabled: boolean
  mode: string
  stream: MediaStream | null
  micLost: boolean
  /** When the recording began, or null before it has. */
  startedAt: number | null
  flushSegment: () => void
  /** Called once, when the countdown runs out. */
  onStop: () => void
  /** Scalar only. Never the transcript, never the phrase. */
  onEvent?: (message: string) => void
}

export function useSmartSessionEnd(opts: Options) {
  const armed = opts.enabled && opts.mode === 'conversation'
  const { snapshotRef, speechResumedAt } = useVoiceActivity(opts.stream, armed)

  const [state, setState] = useState<SessionEndState>('LISTENING')
  const [secondsLeft, setSecondsLeft] = useState(0)

  const segmentRef = useRef<{ text: string; at: number } | null>(null)
  // The candidate already answered - by speech, or by the doctor. Only a NEWER
  // segment may raise the countdown again, or cancelling it would be pointless.
  const answeredAtRef = useRef(0)
  const flushedForQuietRef = useRef(false)
  const deadlineRef = useRef(0)
  const optsRef = useRef(opts)
  optsRef.current = opts

  /** Handed to the recorder's `start`, so the tail arrives here as it lands. */
  const noteSegment = useCallback((segment: { segNo: number; text: string; at: number }) => {
    segmentRef.current = { text: segment.text, at: segment.at }
  }, [])

  // Anyone speaking cancels, whatever is on screen and without a tap. This is
  // the one signal that must never be missed, which is why it has its own
  // effect rather than waiting for the next poll.
  useEffect(() => {
    if (!speechResumedAt) return
    flushedForQuietRef.current = false
    setState(prev => {
      if (prev !== 'POSSIBLE_END' && prev !== 'COUNTDOWN') return prev
      answeredAtRef.current = segmentRef.current?.at ?? 0
      optsRef.current.onEvent?.('smart-end: countdown cancelled (speech)')
      return sessionEndReducer(prev, { type: 'SPEECH' })
    })
  }, [speechResumedAt])

  useEffect(() => {
    if (!armed) return
    const timer = setInterval(() => {
      const now = Date.now()
      const snap = snapshotRef.current
      const started = optsRef.current.startedAt

      setState(prev => {
        if (prev === 'STOPPING') return prev

        if (prev === 'COUNTDOWN') {
          const left = Math.max(0, deadlineRef.current - now)
          setSecondsLeft(Math.ceil(left / 1000))
          if (left > 0) return prev
          optsRef.current.onEvent?.(
            `smart-end: stopped after ${Math.round((now - (started ?? now)) / 60000)}m`,
          )
          optsRef.current.onStop()
          return sessionEndReducer(prev, { type: 'COUNTDOWN_ELAPSED' })
        }

        if (prev === 'POSSIBLE_END') {
          deadlineRef.current = now + COUNTDOWN_MS
          setSecondsLeft(Math.ceil(COUNTDOWN_MS / 1000))
          return sessionEndReducer(prev, { type: 'ARM_COUNTDOWN' })
        }

        // LISTENING. Cut the segment early so its text is back before the
        // silence is long enough to act on - once per quiet spell, not on a
        // timer, so ordinary segments stay at their full length.
        if (snap.available && snap.silenceMs >= FLUSH_AFTER_SILENCE_MS && !flushedForQuietRef.current) {
          flushedForQuietRef.current = true
          optsRef.current.flushSegment()
        }

        const segment = segmentRef.current
        if (segment && segment.at <= answeredAtRef.current) return prev

        const verdict = evaluateSessionEnd({
          enabled: optsRef.current.enabled,
          mode: optsRef.current.mode,
          sessionMs: started === null ? 0 : now - started,
          segment,
          lastSpeechAt: snap.available ? snap.lastSpeechAt : null,
          silenceMs: snap.silenceMs,
          micLost: optsRef.current.micLost,
        })
        if (verdict !== 'possible-end') return prev

        optsRef.current.onEvent?.(`smart-end: candidate after ${Math.round(snap.silenceMs / 1000)}s quiet`)
        return sessionEndReducer(prev, { type: 'CANDIDATE' })
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [armed, snapshotRef])

  /** The doctor says carry on. The candidate that raised this is spent. */
  const keepRecording = useCallback(() => {
    answeredAtRef.current = segmentRef.current?.at ?? Date.now()
    optsRef.current.onEvent?.('smart-end: countdown cancelled (doctor)')
    setState(prev => sessionEndReducer(prev, { type: 'KEEP_RECORDING' }))
  }, [])

  /** Manual Stop, the fixed-duration auto-stop, or Stop now. Moves the machine
   *  to STOPPING, which absorbs everything that arrives after it. */
  const noteStopping = useCallback(() => {
    setState(prev => sessionEndReducer(prev, { type: 'STOP' }))
  }, [])

  return {
    countingDown: state === 'COUNTDOWN',
    secondsLeft,
    noteSegment,
    keepRecording,
    noteStopping,
    /** Exposed for the tail of the silence window, so a screen can say how long
     *  it has been quiet if it ever wants to. */
    silenceThresholdMs: SILENCE_MS,
  }
}
