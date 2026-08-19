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

// Merges rather than overwrites. It runs against the stub written at first
// sign-in, so the document already exists and this is an UPDATE — and updates
// now have to leave `billing` exactly as they found it. A full overwrite omits
// that field, which reads as removing it, and the rules refuse. Merging is also
// simply correct: nothing here is trying to erase state written elsewhere.
export async function createProfile(uid: string, data: Partial<User>): Promise<void> {
  const ref = doc(db, 'users', uid)
  await setDoc(ref, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

// A minimal record written the first time a doctor authenticates, BEFORE they
// finish onboarding. Without it a half-finished signup leaves no trace at all —
// no admin row, no cohort, no way to reach them. `onboardingComplete: false` is
// what marks it a stub; the app already routes such a profile to onboarding, and
// createProfile overwrites it wholesale on completion.
//
// Deliberately minimal: no `status` or `tier`, which the security rules pin on
// create, and nothing that would make it look like a finished account.
export async function ensureProfileStub(uid: string, email: string, displayName: string): Promise<void> {
  const ref = doc(db, 'users', uid)
  if ((await getDoc(ref)).exists()) return
  await setDoc(ref, {
    uid,
    email,
    displayName: displayName.slice(0, 200),
    onboardingComplete: false,
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
