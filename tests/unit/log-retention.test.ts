import { describe, it, expect } from 'vitest'
import { LOG_RETENTION_DAYS, LOG_RETENTION_MS } from '@/lib/firestore/systemLogs'

// A Firestore TTL policy deletes a document once its field is in the PAST.
// system_logs had no such field, so the only candidate was `createdAt` - and a
// policy pointed at that would have deleted every log within a day, silently,
// at exactly the moment someone went looking for one.
//
// `expiresAt` is therefore written as a FUTURE Timestamp, the same shape
// stripe_events already uses. This pins the window; the Timestamp-vs-number
// mistake (a numeric field is ignored by the policy, so nothing is deleted and
// it looks identical to a policy that works) is documented at the call site.

describe('log retention', () => {
  it('keeps logs long enough to investigate a complaint raised weeks later', () => {
    expect(LOG_RETENTION_DAYS).toBe(90)
  })

  it('is a positive window, so expiresAt is always in the future', () => {
    expect(LOG_RETENTION_MS).toBeGreaterThan(0)
    expect(Date.now() + LOG_RETENTION_MS).toBeGreaterThan(Date.now())
  })

  it('agrees with itself in both units', () => {
    expect(LOG_RETENTION_MS).toBe(LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  })
})
