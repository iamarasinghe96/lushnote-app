'use client'

import { useEffect, useRef, useState } from 'react'
import { displayLevel, pushLevel, rmsLevel } from '@/lib/micLevel'

// The live level meter on the recording screen. It is driven by the real
// microphone and nothing else: a bar row that animates on a timer would tell a
// doctor their consultation is being picked up at exactly the moment it is not,
// which is the one lie this screen must never tell. When the mic goes quiet the
// bars go flat, because that is the truth.

const BARS = 44
const MAX_H = 52
const MIN_H = 3

// 16 samples a second. Fast enough to read as a voice, slow enough that a phone
// already running MediaRecorder, segment uploads and a transcription queue is
// not also reconciling 44 nodes on every frame.
const SAMPLE_MS = 60
// Under reduced motion the meter keeps reporting - it is information, not
// decoration - but at a pace that does not read as animation.
const SAMPLE_MS_REDUCED = 250

interface Props {
  stream: MediaStream | null
  /** Mic interrupted (a phone call, the screen locked). Flattens the meter. */
  lost?: boolean
}

export default function RecordingWave({ stream, lost }: Props) {
  const [levels, setLevels] = useState<number[]>([])
  const levelsRef = useRef<number[]>([])

  useEffect(() => {
    if (!stream) return
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
      // Connected to the analyser and to NOTHING else. Routing a microphone to
      // the speakers in a consulting room is feedback.
      source.connect(analyser)
    } catch {
      return
    }
    // An AudioContext built outside a gesture starts suspended on some engines.
    void ctx.resume().catch(() => {})

    const bytes = new Uint8Array(analyser.fftSize)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(bytes)
      levelsRef.current = pushLevel(levelsRef.current, displayLevel(rmsLevel(bytes)), BARS)
      setLevels(levelsRef.current)
    }, reduced ? SAMPLE_MS_REDUCED : SAMPLE_MS)

    return () => {
      clearInterval(timer)
      try { source.disconnect() } catch { /* already gone */ }
      void ctx.close().catch(() => {})
    }
  }, [stream])

  // Oldest on the left, newest on the right, and a floor of quiet bars before
  // the first samples arrive so the meter has a shape from the first frame.
  const shown = [...Array<number>(Math.max(0, BARS - levels.length)).fill(0), ...levels]

  return (
    <div className="flex items-center justify-center gap-[2px] h-[56px]" aria-hidden>
      {shown.map((level, index) => {
        const height = lost ? MIN_H : Math.max(MIN_H, Math.round(level * MAX_H))
        return (
          <span
            key={index}
            className="w-[3px] rounded-full"
            style={{
              height,
              background: lost ? '#f59e0b' : '#10b981',
              // Older samples recede, so the eye follows the live end.
              opacity: 0.35 + 0.65 * (index / BARS),
            }}
          />
        )
      })}
    </div>
  )
}
