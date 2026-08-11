// Server-side profile reads/writes for the API routes. These MUST use the
// Firebase Admin SDK: the client SDK cannot authenticate inside a serverless
// function, so the deployed security rules deny every read/write and the
// per-user Gemini usage counter never advances. The Admin SDK authenticates
// with the service account and bypasses those client rules.
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { quotaDate } from '@/lib/utils'
import type { User, GeminiUsage } from '@/types'

const GEMINI_RPD = 20

export async function getProfile(uid: string): Promise<User | null> {
  const snap = await adminDb().collection('users').doc(uid).get()
  return snap.exists ? (snap.data() as User) : null
}

// Atomically increment today's request count (resetting on a new UTC-Pacific
// day) and accumulate token usage, so concurrent calls can't clobber each other.
export async function updateGeminiUsage(uid: string, modelKey: string, tokens = 0): Promise<void> {
  const ref = adminDb().collection('users').doc(uid)
  const today = quotaDate()
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existing = (snap.data()?.geminiUsage as GeminiUsage | undefined)?.[modelKey]
    // Same stale-peg release as checkQuota: a record at the cap with no tokens
    // came from the old shared-key behaviour, so start the day's real count from
    // it rather than incrementing to 21 and leaving the display wrong.
    const stalePeg = !!existing && existing.date === today
      && existing.count >= GEMINI_RPD && (existing.tokens ?? 0) === 0
    const newRecord = existing && existing.date === today && !stalePeg
      ? { count: existing.count + 1, date: today, tokens: (existing.tokens ?? 0) + tokens }
      : { count: 1, date: today, tokens }
    tx.set(ref, { geminiUsage: { [modelKey]: newRecord }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

// The shared GEMINI_API_KEY is ONE Google project serving every doctor, so when
// it runs out that is a fact about the app, not about whoever happened to make
// the next request. Writing it into that doctor's counter — which is what used
// to happen — locked them out for the rest of the day and showed "Used 20 / 20"
// against a quota they had not touched.
//
// It is also a short cooldown rather than a day. Google's 429 bundles several
// quota metrics, so a per-minute stumble reads as a per-day exhaustion; on that
// signal a day-long lockout is far too expensive. Ten minutes costs one wasted
// call to re-check a genuine daily exhaustion, and costs a per-minute stumble
// almost nothing.
const SHARED_COOLDOWN_MS = 10 * 60 * 1000

function sharedGeminiRef() {
  return adminDb().collection('system').doc('geminiShared')
}

export async function markSharedGeminiExhausted(): Promise<void> {
  await sharedGeminiRef().set(
    { cooldownUntil: Date.now() + SHARED_COOLDOWN_MS, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

export async function sharedGeminiAvailable(): Promise<boolean> {
  try {
    const snap = await sharedGeminiRef().get()
    const until = snap.exists ? (snap.data()?.cooldownUntil as number | undefined) : undefined
    return !until || Date.now() >= until
  } catch {
    return true   // never let a bookkeeping read block a doctor's generation
  }
}
