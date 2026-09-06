import { describe, it, expect } from 'vitest'
import {
  partitionDrafts,
  draftExpiryDate,
  DRAFT_TTL_DAYS,
  MAX_LIVE_DRAFTS,
} from '@/lib/draftRetention'

// There used to be exactly one draft, called 'current'. Recording a second
// patient before the first became a note overwrote the first, silently — and
// because the write merged, a half-finished handoff survived onto the new
// transcript: patient B's session carrying patient A's name and reg number.
//
// One document per recording session fixes both. The cost is that abandoned
// drafts accumulate, and a draft is a full patient transcript.

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 4)
const at = (id: string, daysAgo: number) => ({ id, updatedAtMs: NOW - daysAgo * DAY })

describe('partitionDrafts', () => {
  it('keeps a recent recording', () => {
    const { live, expired } = partitionDrafts([at('a', 1)], NOW)
    expect(live.map(d => d.id)).toEqual(['a'])
    expect(expired).toHaveLength(0)
  })

  it('expires one older than the retention window', () => {
    const { live, expired } = partitionDrafts([at('old', DRAFT_TTL_DAYS + 1)], NOW)
    expect(live).toHaveLength(0)
    expect(expired.map(d => d.id)).toEqual(['old'])
  })

  it('keeps one right on the edge', () => {
    // A draft written exactly at the cutoff is still inside the window. Off by
    // one here deletes a consultation a day early.
    const { live } = partitionDrafts([at('edge', DRAFT_TTL_DAYS)], NOW)
    expect(live.map(d => d.id)).toEqual(['edge'])
  })

  it('returns newest first, whatever order it was given', () => {
    // Sorting happens here so a caller cannot get "the newest" wrong — the
    // generate-page banner offers list[0] and that must be the latest session.
    const { live } = partitionDrafts([at('older', 3), at('newest', 1), at('mid', 2)], NOW)
    expect(live.map(d => d.id)).toEqual(['newest', 'mid', 'older'])
  })

  it('treats a draft with no timestamp as old, not new', () => {
    // It predates the field, so it is from an earlier build. Showing a stale
    // transcript as the newest recording is how a doctor opens the wrong
    // session.
    const { live, expired } = partitionDrafts([{ id: 'legacy' }, at('recent', 1)], NOW)
    expect(live.map(d => d.id)).toEqual(['recent'])
    expect(expired.map(d => d.id)).toEqual(['legacy'])
  })

  it('caps how many are kept, newest surviving', () => {
    const many = Array.from({ length: MAX_LIVE_DRAFTS + 3 }, (_, i) => at(`d${i}`, i * 0.01))
    const { live, expired } = partitionDrafts(many, NOW)
    expect(live).toHaveLength(MAX_LIVE_DRAFTS)
    expect(expired).toHaveLength(3)
    expect(live[0].id).toBe('d0')
  })

  it('never loses a draft — every input lands on exactly one side', () => {
    const input = [at('a', 1), at('b', 99), { id: 'c' }]
    const { live, expired } = partitionDrafts(input, NOW)
    expect([...live, ...expired].map(d => d.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('copes with nothing at all', () => {
    expect(partitionDrafts([], NOW)).toEqual({ live: [], expired: [] })
  })
})

describe('draftExpiryDate', () => {
  it('is a Date in the future, not a millisecond number', () => {
    // Firestore's TTL policy ignores a plain number — a trap this repo has
    // already hit once with stripe_events.
    const d = draftExpiryDate(NOW)
    expect(d).toBeInstanceOf(Date)
    expect(d.getTime()).toBeGreaterThan(NOW)
  })

  it('is the retention window away', () => {
    expect(draftExpiryDate(NOW).getTime()).toBe(NOW + DRAFT_TTL_DAYS * DAY)
  })
})
