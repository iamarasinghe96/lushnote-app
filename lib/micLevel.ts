// Turning an AnalyserNode's time-domain buffer into something a bar meter can
// draw. Pure and separate from the component so the arithmetic can be tested
// without a browser, an AudioContext or a microphone.

/**
 * Root mean square of a time-domain byte buffer, 0 (silence) to 1 (full scale).
 * `getByteTimeDomainData` centres every sample on 128, so each byte is read as
 * an offset from there.
 */
export function rmsLevel(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let sum = 0
  for (let i = 0; i < bytes.length; i++) {
    const sample = (bytes[i] - 128) / 128
    sum += sample * sample
  }
  return Math.sqrt(sum / bytes.length)
}

/**
 * The height to draw, 0 to 1. Ordinary speech into a laptop microphone sits
 * around 0.05-0.2 RMS, so a bar drawn at the raw figure never leaves the floor
 * and the meter looks dead while the recorder is working perfectly. The gain
 * lifts the quiet end and the square root keeps a loud room from pegging every
 * bar at the ceiling.
 */
export function displayLevel(rms: number, gain = 4): number {
  if (!(rms > 0)) return 0
  return Math.min(1, Math.sqrt(rms * gain))
}

/** The rolling window of recent levels, newest last, never longer than `max`. */
export function pushLevel(levels: readonly number[], next: number, max: number): number[] {
  const out = [...levels, next]
  return out.length > max ? out.slice(out.length - max) : out
}
