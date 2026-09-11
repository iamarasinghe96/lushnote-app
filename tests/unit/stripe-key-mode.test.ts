import { describe, it, expect } from 'vitest'
import { publishableKeyMode, keyModeMismatch } from '@/lib/stripeKeyMode'

// A key, a price and a client secret each belong to ONE Stripe mode, and mixing
// them fails silently: Stripe.js loads, Elements mounts, the Payment Element
// renders an empty box, and the real complaint appears only in the browser
// console. The doctor sees a form that cannot be submitted and no reason why.
//
// Diagnosing that from the outside cost a working afternoon. These pin the
// check that now says it on the page.

describe('publishableKeyMode', () => {
  it('reads the mode off the prefix', () => {
    expect(publishableKeyMode('pk_live_abc123')).toBe('live')
    expect(publishableKeyMode('pk_test_abc123')).toBe('test')
  })

  it('is unknown for anything it does not recognise', () => {
    expect(publishableKeyMode(undefined)).toBe('unknown')
    expect(publishableKeyMode('')).toBe('unknown')
    expect(publishableKeyMode('sk_live_abc')).toBe('unknown')
    expect(publishableKeyMode('nonsense')).toBe('unknown')
  })

  it('ignores surrounding whitespace, which a paste into Vercel adds', () => {
    expect(publishableKeyMode('  pk_live_abc  ')).toBe('live')
  })
})

describe('keyModeMismatch', () => {
  it('says nothing when the two agree', () => {
    expect(keyModeMismatch('pk_live_abc', 'live')).toBeNull()
    expect(keyModeMismatch('pk_test_abc', 'test')).toBeNull()
  })

  it('names both sides when they disagree', () => {
    // The exact fault that produced an unsubmittable form: server switched to
    // live, browser key left on test.
    const msg = keyModeMismatch('pk_test_abc', 'live')
    expect(msg).toMatch(/browser key is test/)
    expect(msg).toMatch(/server key is live/)
  })

  it('catches the mismatch in the other direction too', () => {
    const msg = keyModeMismatch('pk_live_abc', 'test')
    expect(msg).toMatch(/browser key is live/)
    expect(msg).toMatch(/server key is test/)
  })

  it('reports nothing when either side is unknown', () => {
    // A MISSING key is a different fault with a different fix, and it already
    // has its own message. Calling it a mismatch would send somebody to change
    // the wrong variable.
    expect(keyModeMismatch(undefined, 'live')).toBeNull()
    expect(keyModeMismatch('pk_live_abc', undefined)).toBeNull()
    expect(keyModeMismatch('pk_live_abc', 'off')).toBeNull()
    expect(keyModeMismatch(undefined, undefined)).toBeNull()
  })
})
