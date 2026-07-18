import { db } from '@/lib/firebase'
import {
  doc, getDoc, collection, query, where, getDocs,
} from 'firebase/firestore'
import { toOrganizationKey } from '@/lib/utils'
import type { HospitalFormDoc } from '@/types'

// Forms available to a given workplace. Gated by organizationKeys so a form only
// appears for the campuses it belongs to (mirrors the letterhead org-key scheme;
// toOrganizationKey lives in lib/utils). Returns [] on any failure so the
// Create-Document flow degrades gracefully to letters/notes only.
export async function getHospitalFormsForWorkplace(workplaceName: string): Promise<HospitalFormDoc[]> {
  if (!workplaceName) return []
  const key = toOrganizationKey(workplaceName)
  try {
    const snap = await getDocs(query(
      collection(db, 'hospitalForms'),
      where('organizationKeys', 'array-contains', key),
    ))
    return snap.docs.map(d => d.data() as HospitalFormDoc)
  } catch {
    return []
  }
}

// A single form by its key — used to resolve a recovered dictation draft
// (letterType 'hospitalform:<formKey>') back to its form config.
export async function getHospitalForm(formKey: string): Promise<HospitalFormDoc | null> {
  if (!formKey) return null
  try {
    const snap = await getDoc(doc(db, 'hospitalForms', formKey))
    return snap.exists() ? (snap.data() as HospitalFormDoc) : null
  } catch {
    return null
  }
}
