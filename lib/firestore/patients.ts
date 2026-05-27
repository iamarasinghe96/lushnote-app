import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { PatientProfile } from '@/types'

export async function getPatientProfiles(uid: string): Promise<Record<string, PatientProfile>> {
  const col = collection(db, 'users', uid, 'patientProfiles')
  const snap = await getDocs(col)
  const result: Record<string, PatientProfile> = {}
  snap.docs.forEach(d => {
    result[d.id] = { id: d.id, ...d.data() } as PatientProfile
  })
  return result
}

export async function savePatientProfile(uid: string, profile: PatientProfile): Promise<string> {
  const col = collection(db, 'users', uid, 'patientProfiles')
  if (profile.id) {
    const ref = doc(col, profile.id)
    const { id: _, ...data } = profile
    await updateDoc(ref, { ...data })
    return profile.id
  }
  const ref = await addDoc(col, { ...profile })
  return ref.id
}

export async function deletePatientProfile(uid: string, profileId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'patientProfiles', profileId))
}

export async function deleteAllPatientProfiles(uid: string): Promise<void> {
  const col = collection(db, 'users', uid, 'patientProfiles')
  const snap = await getDocs(col)
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}
