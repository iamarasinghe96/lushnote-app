import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { quotaDate } from '@/lib/utils'
import type { User, GeminiUsage } from '@/types'

const GEMINI_RPD = 20

export async function getProfile(uid: string): Promise<User | null> {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return snap.data() as User
}

export async function createProfile(uid: string, data: Partial<User>): Promise<void> {
  const ref = doc(db, 'users', uid)
  await setDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateProfile(uid: string, data: Partial<User>): Promise<void> {
  const ref = doc(db, 'users', uid)
  // JSON round-trip strips undefined from nested structures (workplaces array etc.)
  // Firestore rejects undefined values in updateDoc
  const serialized = JSON.parse(JSON.stringify(data))
  await updateDoc(ref, {
    ...serialized,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteProfile(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid))
}

export async function updateGeminiUsage(uid: string, modelKey: string, tokens = 0): Promise<void> {
  const today = quotaDate()
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  const existing = (snap.data()?.geminiUsage as GeminiUsage | undefined)?.[modelKey]

  const newRecord =
    existing && existing.date === today
      ? { count: existing.count + 1, date: today, tokens: (existing.tokens ?? 0) + tokens }
      : { count: 1, date: today, tokens }

  await updateDoc(ref, {
    [`geminiUsage.${modelKey}`]: newRecord,
    updatedAt: serverTimestamp(),
  })
}

// Google returned 429 for this key — peg the local counter to the daily
// limit so the UI reflects the real "limit reached" state instead of a
// stale low number, and the app routes to Groq.
export async function markGeminiLimitReached(uid: string, modelKey: string): Promise<void> {
  const today = quotaDate()
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  const existing = (snap.data()?.geminiUsage as GeminiUsage | undefined)?.[modelKey]
  await updateDoc(ref, {
    [`geminiUsage.${modelKey}`]: {
      count: GEMINI_RPD,
      date: today,
      tokens: existing && existing.date === today ? (existing.tokens ?? 0) : 0,
    },
    updatedAt: serverTimestamp(),
  })
}
