// Server-side profile reads/writes for the API routes. These MUST use the
// Firebase Admin SDK: the client SDK cannot authenticate inside a serverless
// function, so the deployed security rules deny every read/write and the
// per-user Gemini usage counter never advances. The Admin SDK authenticates
// with the service account and bypasses those client rules.
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { quotaDate } from '@/lib/utils'
import type { User, GeminiUsage } from '@/types'

export async function getProfile(uid: string): Promise<User | null> {
  const snap = await adminDb().collection('users').doc(uid).get()
  return snap.exists ? (snap.data() as User) : null
}

// Atomically increment today's request count (resetting on a new UTC-Pacific
// day) and accumulate token usage, so concurrent calls can't clobber each other.
export async function updateGeminiUsage(
  uid: string,
  modelKey: string,
  usage: number | { prompt: number; output: number; thoughts: number; total: number } = 0,
): Promise<void> {
  const u = typeof usage === 'number'
    ? { prompt: 0, output: 0, thoughts: 0, total: usage }
    : usage
  const ref = adminDb().collection('users').doc(uid)
  const today = quotaDate()
  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existing = (snap.data()?.geminiUsage as GeminiUsage | undefined)?.[modelKey]
    const same = existing && existing.date === today
    const newRecord = {
      count: same ? existing.count + 1 : 1,
      date: today,
      tokens: (same ? (existing.tokens ?? 0) : 0) + u.total,
      promptTokens: (same ? (existing.promptTokens ?? 0) : 0) + u.prompt,
      outputTokens: (same ? (existing.outputTokens ?? 0) : 0) + u.output,
      thoughtsTokens: (same ? (existing.thoughtsTokens ?? 0) : 0) + u.thoughts,
    }
    tx.set(ref, { geminiUsage: { [modelKey]: newRecord }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}
