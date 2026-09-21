import { describe, expect, it } from 'vitest'
import { inAustralia } from '@/lib/locale'

// What this decides: which tab the Stripe payment form opens on. An Australian
// doctor should land on bank debit, which is how most of them will pay, and
// everyone else should land on the card fields - offering an AU-only direct
// debit as the default to someone overseas is a dead end, not a convenience.

describe('inAustralia', () => {
  it.each([
    'Australia/Melbourne',
    'Australia/Sydney',
    'Australia/Perth',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Darwin',
    'Australia/Hobart',
  ])('recognises %s', zone => {
    expect(inAustralia(zone, 'en-US')).toBe(true)
  })

  it.each([
    ['Europe/London', 'en-GB'],
    ['America/New_York', 'en-US'],
    ['Pacific/Auckland', 'en-NZ'],
    ['Asia/Singapore', 'en-SG'],
  ])('leaves %s alone', (zone, language) => {
    expect(inAustralia(zone, language)).toBe(false)
  })

  // The fallback, for a browser that will not report a usable zone.
  it('falls back to a language that names AU outright', () => {
    expect(inAustralia('', 'en-AU')).toBe(true)
    expect(inAustralia('', 'EN-au')).toBe(true)
  })

  it('does not read AU out of a language that merely contains it', () => {
    // The tag for Austrian German. Close enough to matter.
    expect(inAustralia('', 'de-AT')).toBe(false)
    expect(inAustralia('', 'au-NZ')).toBe(false)
  })

  it('has an answer when the platform says nothing', () => {
    expect(inAustralia('', '')).toBe(false)
  })
})
