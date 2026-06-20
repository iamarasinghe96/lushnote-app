import { db } from '@/lib/firebase'
import {
  doc, getDoc, collection, addDoc, serverTimestamp, query, where, getDocs,
} from 'firebase/firestore'
import { toOrganizationKey } from '@/lib/utils'

export interface LetterheadDoc {
  organizationKey: string
  organizationName: string
  headerUrl: string | null
  footerUrl: string | null
}

export async function getLetterhead(workplaceName: string): Promise<LetterheadDoc | null> {
  if (!workplaceName) return null
  const key = toOrganizationKey(workplaceName)
  try {
    const snap = await getDoc(doc(db, 'letterheads', key))
    if (!snap.exists()) return null
    return snap.data() as LetterheadDoc
  } catch {
    return null
  }
}

export async function submitLetterheadRequest(params: {
  uid: string
  email: string
  displayName: string
  workplaceName: string
  note: string
}): Promise<void> {
  const { uid, email, displayName, workplaceName, note } = params
  const key = toOrganizationKey(workplaceName)

  // Skip if a pending request already exists from this user for this org
  // Wrapped in try-catch: if the read is denied by rules, fall through to create
  try {
    const existing = await getDocs(
      query(
        collection(db, 'letterheadRequests'),
        where('requestedBy', '==', uid),
        where('organizationKey', '==', key),
        where('status', '==', 'pending'),
      )
    )
    if (!existing.empty) return
  } catch { /* rules may deny list; proceed to create */ }

  await addDoc(collection(db, 'letterheadRequests'), {
    organizationKey: key,
    organizationName: workplaceName,
    requestedBy: uid,
    requestedByEmail: email,
    requestedByName: displayName,
    workplaceName,
    note,
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}
