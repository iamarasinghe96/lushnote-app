import { describe, it, expect } from 'vitest'
import { classifyGenerationFailure, failureDialogCopy } from '@/lib/generationFailure'

// Generation retries once before telling the doctor anything, because most
// failures here are a busy model or a gateway timeout on a long consultation and
// succeed on the second attempt. But a wrong key, a spent quota or a lapsed
// subscription fails identically the second time, and a doctor watching a
// spinner for a pointless attempt is worse than being told straight away.
//
// So this decides which. Getting it wrong in one direction wastes the doctor's
// time; in the other it burns one of their 20 daily Gemini calls.

const kinds = (m: string | undefined, s?: number) => classifyGenerationFailure(m, s).kind

describe('classifyGenerationFailure — worth retrying', () => {
  it('retries a gateway timeout', () => {
    expect(kinds('', 504)).toBe('transient')
    expect(kinds('', 502)).toBe('transient')
  })

  it('retries a garbled reply', () => {
    // The route's own message says it usually works on a second attempt.
    expect(kinds('The AI reply came back garbled. Please try again — it usually works on a second attempt.', 502)).toBe('transient')
  })

  it('retries a dropped connection, which has no status at all', () => {
    expect(kinds(undefined, undefined)).toBe('transient')
    expect(kinds('Failed to fetch')).toBe('transient')
  })

  it('retries an unrecognised server error', () => {
    // Unknown failures fail toward trying again: one extra attempt costs a few
    // seconds, while refusing to retry a recoverable fault costs the note.
    expect(kinds('Generation failed', 500)).toBe('transient')
  })
})

describe('classifyGenerationFailure — pointless to retry', () => {
  it('does not retry a spent daily quota', () => {
    expect(kinds('GEMINI_DAILY_LIMIT', 429)).toBe('terminal')
    expect(kinds('Rate limit exceeded per day', 429)).toBe('terminal')
  })

  it('does not retry a bad API key', () => {
    expect(kinds('GEMINI_KEY_INVALID', 500)).toBe('terminal')
    expect(kinds('Invalid API key', 400)).toBe('terminal')
  })

  it('does not retry a lapsed subscription or a suspension', () => {
    expect(kinds('Your LushNote subscription needs attention', 402)).toBe('terminal')
    expect(kinds('Account suspended', 403)).toBe('terminal')
    // Even with an unhelpful body, the status alone settles it.
    expect(kinds('', 402)).toBe('terminal')
    expect(kinds('', 403)).toBe('terminal')
  })

  it('does not retry a transcript that is too short to work with', () => {
    expect(kinds('Invalid transcript', 400)).toBe('terminal')
  })

  it('does not retry an oversized request, but offers the real move', () => {
    // Resending an identical too-large request cannot succeed; generating from
    // a shorter stretch can.
    const f = classifyGenerationFailure('', 413)
    expect(f.kind).toBe('terminal')
    expect(f.action).toMatch(/shorter/i)
  })
})

describe('failureDialogCopy', () => {
  it('leads with the reason and ends with a way forward', () => {
    const f = classifyGenerationFailure('GEMINI_DAILY_LIMIT', 429)
    const { title, body } = failureDialogCopy(f)
    expect(title).toBe('Couldn’t write the note')
    expect(body).toContain('limit is used up')
    expect(body).toMatch(/Groq|tomorrow/)
  })

  it('reassures about the recording when there is no other action', () => {
    // The doctor's actual worry is the consultation, not the note. When there is
    // nothing specific to do, say the recording is safe and where to go.
    const { body } = failureDialogCopy(classifyGenerationFailure('', 504))
    expect(body).toContain('recording is saved')
    expect(body).toContain('Patients')
  })

  it('stays short', () => {
    // The old copy was a paragraph. Two clauses is the budget.
    for (const m of ['', 'GEMINI_DAILY_LIMIT', 'Account suspended']) {
      expect(failureDialogCopy(classifyGenerationFailure(m)).body.length).toBeLessThan(120)
    }
  })
})
