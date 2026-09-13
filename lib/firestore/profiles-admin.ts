// Server-side profile reads/writes for the API routes. These MUST use the
// Firebase Admin SDK: the client SDK cannot authenticate inside a serverless
// function, so the deployed security rules deny every read/write and the
// per-user Gemini usage counter never advances. The Admin SDK authenticates
// with the service account and bypasses those client rules.
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { quotaDate, monthKey } from '@/lib/utils'
import type { User, GeminiUsage, AiCostMonth } from '@/types'
import { geminiCostMicros, groqTextCostMicros } from '@/lib/aiCost'

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

/** Kept so a doctor's cost history survives a year of comparisons without the
 *  profile document growing without bound. */
const AI_COST_MONTHS_KEPT = 13

/**
 * Record what one AI call cost, on the doctor it was made for.
 *
 * A SEPARATE transaction from updateGeminiUsage rather than a field on it, for
 * two reasons: Groq calls never go through that function at all, and folding
 * cost into it would mean editing all eleven of its call sites in the same pass
 * that introduces the pricing. Two fire-and-forget transactions on one document
 * is contention Firestore already retries through; a half-migrated meter is not.
 *
 * Keyed by MONTH, not day. The ceiling this will eventually feed is monthly, and
 * a monthly key means reading it costs nothing extra - the routes have already
 * loaded the profile for the entitlement check.
 *
 * `micros` of null means the model had no price in lib/aiCost. The call is still
 * counted, under `unpriced`, so a renamed model shows up as a gap rather than
 * silently costing zero.
 */
export async function recordAiSpend(
  uid: string,
  spend: { micros: number | null; provider: 'gemini' | 'groq' },
): Promise<void> {
  if (!uid) return
  const ref = adminDb().collection('users').doc(uid)
  const key = monthKey()

  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    // No profile means nothing to meter against. Creating one here would invent
    // a doctor from an unauthenticated request.
    if (!snap.exists) return
    const all = (snap.data()?.aiCost ?? {}) as Record<string, AiCostMonth | undefined>
    const prev = all[key]

    const priced = typeof spend.micros === 'number'
    const next: AiCostMonth = {
      micros: (prev?.micros ?? 0) + (priced ? spend.micros! : 0),
      calls: (prev?.calls ?? 0) + 1,
      unpriced: (prev?.unpriced ?? 0) + (priced ? 0 : 1),
      gemini: (prev?.gemini ?? 0) + (spend.provider === 'gemini' && priced ? spend.micros! : 0),
      groq: (prev?.groq ?? 0) + (spend.provider === 'groq' && priced ? spend.micros! : 0),
      updatedAt: Date.now(),
    }

    // Prune inside the same transaction. A MERGE write cannot delete map keys,
    // so once the window is outgrown the whole map is rewritten with update(),
    // which replaces a field wholesale.
    const merged: Record<string, AiCostMonth> = {}
    for (const [k, v] of Object.entries(all)) if (v) merged[k] = v
    merged[key] = next

    const keys = Object.keys(merged).sort()
    if (keys.length > AI_COST_MONTHS_KEPT) {
      const trimmed: Record<string, AiCostMonth> = {}
      for (const k of keys.slice(-AI_COST_MONTHS_KEPT)) trimmed[k] = merged[k]
      tx.update(ref, { aiCost: trimmed, updatedAt: FieldValue.serverTimestamp() })
      return
    }

    tx.set(ref, { aiCost: { [key]: next }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

/**
 * The quota counter and the cost meter, together.
 *
 * Every Gemini call needs both and they are easy to get out of step by hand, so
 * call sites take this rather than remembering the pair. Two transactions, not
 * one: they write different fields for different purposes, and merging them
 * would mean the quota counter could not advance when pricing failed.
 *
 * `audioTokens` is the slice of `usage.prompt` that was audio. Gemini reports
 * audio inside promptTokenCount, so leaving this at 0 prices a recorded
 * consultation at the text rate and under-reports the largest cost in the app.
 */
export async function meterGemini(
  uid: string,
  modelKey: string,
  usage: number | { prompt: number; output: number; thoughts: number; total: number } = 0,
  audioTokens = 0,
): Promise<void> {
  if (!uid) return
  const u = typeof usage === 'number' ? { prompt: 0, output: 0, thoughts: 0, total: usage } : usage
  await Promise.all([
    updateGeminiUsage(uid, modelKey, usage).catch(() => {}),
    recordAiSpend(uid, { micros: geminiCostMicros(u, modelKey, audioTokens), provider: 'gemini' }).catch(() => {}),
  ])
}

/** Groq text generation. Groq reports one total with no prompt/output split. */
export async function meterGroq(uid: string, totalTokens: number): Promise<void> {
  if (!uid) return
  await recordAiSpend(uid, { micros: groqTextCostMicros(totalTokens), provider: 'groq' }).catch(() => {})
}
