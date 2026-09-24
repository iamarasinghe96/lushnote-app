import { describe, expect, it, vi } from 'vitest'
import { withGeminiHandover } from '@/lib/geminiHandover'

// The requirement this exists for: when a Pro doctor's free key gives out, no
// note and no transcribed segment is lost. Every test below is a way a handover
// could have dropped the doctor's work, or charged us for nothing.

describe('withGeminiHandover', () => {
  // Everyone who is not a Pro doctor on their free allowance.
  it('makes exactly one call, uncounted, when there is nothing to hand over to', async () => {
    const call = vi.fn(async (key: string) => `served by ${key}`)
    const onFreeAttempt = vi.fn(async () => {})
    await expect(withGeminiHandover('own', null, call, { onFreeAttempt })).resolves.toBe('served by own')
    expect(call).toHaveBeenCalledTimes(1)
    expect(onFreeAttempt).not.toHaveBeenCalled()
  })

  it('never touches the paid key when the free key answers', async () => {
    const call = vi.fn(async (key: string) => `served by ${key}`)
    await expect(withGeminiHandover('free', 'paid', call)).resolves.toBe('served by free')
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('free')
  })

  // The case the whole thing is for. The request that was in flight when the
  // free key gave out is sent again on the paid key, and the doctor gets that.
  it('sends the same request again on the paid key when the free key fails', async () => {
    const call = vi.fn(async (key: string) => {
      if (key === 'free') throw new Error('GEMINI_DAILY_LIMIT')
      return 'the note'
    })
    await expect(withGeminiHandover('free', 'paid', call)).resolves.toBe('the note')
    expect(call.mock.calls.map(c => c[0])).toEqual(['free', 'paid'])
  })

  it.each(['GEMINI_DAILY_LIMIT', 'GEMINI_RATE_LIMIT', 'GEMINI_KEY_INVALID', 'GEMINI_OVERLOADED', 'socket hang up'])(
    'hands over on %s too - a Pro doctor has no reason to see a free-key failure',
    async message => {
      const call = vi.fn(async (key: string) => {
        if (key === 'free') throw new Error(message)
        return 'the note'
      })
      await expect(withGeminiHandover('free', 'paid', call)).resolves.toBe('the note')
    },
  )

  // Resent once, and only once. If the paid key fails as well, that is a real
  // failure and the caller's existing handling must see it - not a silence.
  it('lets a paid-key failure through to the caller rather than swallowing it', async () => {
    const call = vi.fn(async (key: string) => { throw new Error(`${key} failed`) })
    await expect(withGeminiHandover('free', 'paid', call)).rejects.toThrow('paid failed')
    expect(call).toHaveBeenCalledTimes(2)
  })

  // An attempt, not a success. A revoked or throttled free key still used a
  // try; counting only successes would let a dead key be tried first on every
  // request for the rest of the day.
  it('counts the free attempt whether it succeeds or fails', async () => {
    const ok = vi.fn(async () => {})
    await withGeminiHandover('free', 'paid', async () => 'x', { onFreeAttempt: ok })
    expect(ok).toHaveBeenCalledTimes(1)

    const failed = vi.fn(async () => {})
    await withGeminiHandover('free', 'paid', async k => { if (k === 'free') throw new Error('x'); return 'y' },
      { onFreeAttempt: failed })
    expect(failed).toHaveBeenCalledTimes(1)
  })

  // The counter is bookkeeping. A Firestore blip writing it must never cost a
  // doctor the note it was counting.
  it('returns the note even when the counter cannot be written', async () => {
    const onFreeAttempt = vi.fn(() => Promise.reject(new Error('firestore unavailable')))
    await expect(withGeminiHandover('free', 'paid', async () => 'the note', { onFreeAttempt }))
      .resolves.toBe('the note')
  })

  // Committed before the response leaves: a serverless function can be frozen
  // the moment it returns, and an unwritten count would let the free key be
  // tried past the handover point.
  it('does not return until the attempt has been counted', async () => {
    let counted = false
    const onFreeAttempt = () => new Promise<void>(resolve => setTimeout(() => { counted = true; resolve() }, 20))
    await withGeminiHandover('free', 'paid', async () => 'the note', { onFreeAttempt })
    expect(counted).toBe(true)
  })

  // Logs are PHI-safe by contract. The reason is a known code or 'other',
  // never the raw error text, which can carry anything.
  it('reports the handover with a code, never the raw error', async () => {
    const reasons: string[] = []
    const onHandover = (r: string) => reasons.push(r)
    await withGeminiHandover('free', 'paid', async k => { if (k === 'free') throw new Error('GEMINI_DAILY_LIMIT'); return 'y' }, { onHandover })
    await withGeminiHandover('free', 'paid', async k => { if (k === 'free') throw new Error('patient Jane Doe said something'); return 'y' }, { onHandover })
    expect(reasons).toEqual(['GEMINI_DAILY_LIMIT', 'other'])
  })

  it('does not report a handover that did not happen', async () => {
    const onHandover = vi.fn()
    await withGeminiHandover('free', 'paid', async () => 'x', { onHandover })
    expect(onHandover).not.toHaveBeenCalled()
  })
})
