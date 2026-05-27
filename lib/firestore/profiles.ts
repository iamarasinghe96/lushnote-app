import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { User, GeminiUsage } from '@/types'

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
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  })
}

export async function deleteProfile(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid))
}

export async function updateGeminiUsage(uid: string, modelKey: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  const existing = (snap.data()?.geminiUsage as GeminiUsage | undefined)?.[modelKey]

  const newRecord =
    existing && existing.date === today
      ? { count: existing.count + 1, date: today }
      : { count: 1, date: today }

  await updateDoc(ref, {
    [`geminiUsage.${modelKey}`]: newRecord,
    updatedAt: serverTimestamp(),
  })
}
