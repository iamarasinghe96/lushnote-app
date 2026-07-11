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
    const newRecord = existing && existing.date === today
      ? { count: existing.count + 1, date: today, tokens: (existing.tokens ?? 0) + tokens }
      : { count: 1, date: today, tokens }
    tx.set(ref, { geminiUsage: { [modelKey]: newRecord }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

// Peg the counter to the daily limit when Google reports a per-day exhaustion,
// so the UI reflects "limit reached" and the app routes to Groq.
export async function markGeminiLimitReached(uid: string, modelKey: string): Promise<void> {
  const ref = adminDb().collection('users').doc(uid)
  const today = quotaDate()
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existing = (snap.data()?.geminiUsage as GeminiUsage | undefined)?.[modelKey]
    tx.set(ref, {
      geminiUsage: {
        [modelKey]: { count: GEMINI_RPD, date: today, tokens: existing && existing.date === today ? (existing.tokens ?? 0) : 0 },
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
}
