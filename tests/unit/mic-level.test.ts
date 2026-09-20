import { describe, expect, it } from 'vitest'
import { displayLevel, pushLevel, rmsLevel } from '@/lib/micLevel'

// The meter on the recording screen is the only thing telling a doctor the
// microphone is actually picking them up, so it has to be driven by real audio.
// These cover the arithmetic that turns the analyser's buffer into a bar height.

function buffer(fill: number | number[]): Uint8Array {
  if (Array.isArray(fill)) return Uint8Array.from(fill)
  return new Uint8Array(128).fill(fill)
}

describe('rmsLevel', () => {
  it('reads silence as nothing', () => {
    // getByteTimeDomainData centres silence on 128, not on 0.
    expect(rmsLevel(buffer(128))).toBe(0)
  })

  it('reads a full-scale signal as one', () => {
    const square = Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 0 : 255))
    expect(rmsLevel(buffer(square))).toBeGreaterThan(0.99)
  })

  it('rises with amplitude', () => {
    const quiet = rmsLevel(buffer(Array.from({ length: 128 }, (_, i) => 128 + (i % 2 === 0 ? -8 : 8))))
    const loud = rmsLevel(buffer(Array.from({ length: 128 }, (_, i) => 128 + (i % 2 === 0 ? -64 : 64))))
    expect(quiet).toBeLessThan(loud)
    expect(quiet).toBeGreaterThan(0)
  })

  it('has an answer for an empty buffer', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0)
  })
})

describe('displayLevel', () => {
  it('leaves silence on the floor', () => {
    expect(displayLevel(0)).toBe(0)
  })

  // The reason the curve exists: speech RMS is small, and drawn raw the meter
  // looks broken while the recorder is working.
  it('lifts a speaking voice clear of the floor', () => {
    expect(displayLevel(0.08)).toBeGreaterThan(0.5)
  })

  it('never exceeds the ceiling', () => {
    expect(displayLevel(1)).toBe(1)
    expect(displayLevel(50)).toBe(1)
  })

  it('stays ordered', () => {
    expect(displayLevel(0.02)).toBeLessThan(displayLevel(0.2))
  })
})

describe('pushLevel', () => {
  it('keeps the newest sample last', () => {
    expect(pushLevel([0.1, 0.2], 0.3, 10)).toEqual([0.1, 0.2, 0.3])
  })

  it('drops the oldest once the window is full', () => {
    expect(pushLevel([0.1, 0.2, 0.3], 0.4, 3)).toEqual([0.2, 0.3, 0.4])
  })

  it('does not mutate what it was given', () => {
    const levels = [0.1, 0.2, 0.3]
    pushLevel(levels, 0.4, 3)
    expect(levels).toEqual([0.1, 0.2, 0.3])
  })
})
