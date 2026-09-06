import { describe, it, expect } from 'vitest'
import { findQuoteRange } from '@/lib/quoteMatch'

// "Tap to find in transcript" used indexOf, which is case-sensitive and
// whitespace-exact. The model is neither. It looked like a desktop-only fault
// purely because the quote tested on a phone began at a sentence boundary.

// The real transcript and the real quote from the failing report.
const TRANSCRIPT =
  'Okay. So after the summer, um, after the exam period, um, ' +
  'and how did that exam period go for you in the end? Not very well. Okay.'

const slice = (h: string, m: { start: number; end: number } | null) =>
  m ? h.slice(m.start, m.end) : null

describe('findQuoteRange', () => {
  it('finds the quote that used to fail — capitalised mid-sentence', () => {
    // The model lifted a fragment starting at "how" and returned it as "How".
    const m = findQuoteRange(TRANSCRIPT, 'How did that exam period go for you in the end? Not very well.')
    expect(m).not.toBeNull()
    expect(slice(TRANSCRIPT, m)).toBe('how did that exam period go for you in the end? Not very well.')
  })

  it('still finds the one that already worked', () => {
    const q = 'So after the summer, um, after the exam period, um, and how did that exam period go for you in the end? Not very well.'
    expect(slice(TRANSCRIPT, findQuoteRange(TRANSCRIPT, q))).toBe(q)
  })

  it('returns offsets into the ORIGINAL text, not the normalised copy', () => {
    // The caller builds a DOM Range from these. Offsets into a normalised
    // string would highlight the wrong words.
    const m = findQuoteRange(TRANSCRIPT, 'Not very well')!
    expect(TRANSCRIPT.slice(m.start, m.end)).toBe('Not very well')
  })

  it('includes the last character — the end is exclusive', () => {
    const m = findQuoteRange('one two three', 'two')!
    expect('one two three'.slice(m.start, m.end)).toBe('two')
  })

  it('matches across a line break the model returned as a space', () => {
    // The transcript renders whitespace-pre-wrap, so textContent keeps newlines.
    const hay = 'the patient said\nhe felt better today'
    expect(slice(hay, findQuoteRange(hay, 'said he felt better'))).toBe('said\nhe felt better')
  })

  it('matches across doubled and irregular spacing', () => {
    const hay = 'mood   is\t\tstable today'
    expect(slice(hay, findQuoteRange(hay, 'mood is stable'))).toBe('mood   is\t\tstable')
  })

  it('folds curly quotes and dashes the model swaps', () => {
    const hay = 'she said “I’m fine” — mostly'
    expect(findQuoteRange(hay, 'she said "I\'m fine" - mostly')).not.toBeNull()
  })

  it('falls back to the opening words when the tail was trimmed', () => {
    const m = findQuoteRange(TRANSCRIPT, 'How did that exam period go on for several more words that are not there')
    expect(slice(TRANSCRIPT, m)).toBe('how did that exam period')
  })

  it('does not fall back for a short quote', () => {
    // Five words or fewer are already the fallback; matching a prefix of them
    // would highlight something the model did not quote.
    expect(findQuoteRange(TRANSCRIPT, 'no such words here')).toBeNull()
  })

  it('returns null when the quote genuinely is not there', () => {
    // A real answer the caller must show, rather than doing nothing — which is
    // what made this read as a dead button.
    expect(findQuoteRange(TRANSCRIPT, 'the patient reported chest pain overnight')).toBeNull()
  })

  it('copes with empty input', () => {
    expect(findQuoteRange('', 'anything')).toBeNull()
    expect(findQuoteRange(TRANSCRIPT, '')).toBeNull()
    expect(findQuoteRange(TRANSCRIPT, '   ')).toBeNull()
  })

  it('ignores leading and trailing whitespace on the quote', () => {
    expect(slice(TRANSCRIPT, findQuoteRange(TRANSCRIPT, '  Not very well  '))).toBe('Not very well')
  })
})
