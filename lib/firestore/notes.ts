import {
  collection,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  getDocsFromServer,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit as queryLimit,
  writeBatch,
  serverTimestamp,
  startAfter,
  type QueryDocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Note, NoteInput } from '@/types'
import { NOTES_LIST_LIMIT } from '@/lib/notesListLimit'

export async function saveNote(note: NoteInput): Promise<string> {
  const ref = await addDoc(collection(db, 'progress_notes'), {
    ...note,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateNote(noteId: string, fields: Partial<NoteInput>): Promise<void> {
  const ref = doc(db, 'progress_notes', noteId)
  await updateDoc(ref, {
    ...fields,
    updatedAt: serverTimestamp(),
  })
}

export async function getNote(noteId: string): Promise<Note | null> {
  const ref = doc(db, 'progress_notes', noteId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Note
}

export async function listNotes(userId: string, limit = NOTES_LIST_LIMIT): Promise<Note[]> {
  const q = query(
    collection(db, 'progress_notes'),
    where('userId', '==', userId),
    orderBy('updatedAt', 'desc'),
    queryLimit(limit)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Note))
}

export async function deleteNote(noteId: string): Promise<void> {
  await deleteDoc(doc(db, 'progress_notes', noteId))
}

export async function renamePatientInNotes(noteIds: string[], newName: string): Promise<void> {
  if (!noteIds.length) return
  const batch = writeBatch(db)
  noteIds.forEach(id => {
    batch.update(doc(db, 'progress_notes', id), { patient: newName, updatedAt: serverTimestamp() })
  })
  await batch.commit()
}

// A note keeps the clinician name it was written under. After a doctor renames
// themselves in Settings these two let them carry the new name onto the notes
// saved under the old one, and only those: a note signed with any other name
// is left exactly as it is. 500 is the rules' cap on one query. Both read
// from the server, never the offline cache: a cache that happens to be empty
// would report "nothing to update" when there is.
const RENAME_PAGE = 500

function notesByClinician(userId: string, clinician: string) {
  return query(
    collection(db, 'progress_notes'),
    where('userId', '==', userId),
    where('clinician', '==', clinician),
    queryLimit(RENAME_PAGE)
  )
}

/**
 * Every clinician name on this doctor's notes, with how many notes carry it,
 * most common first. Reads the notes a page at a time; 20 pages (10,000 notes)
 * is far beyond any account so far and keeps a runaway read bounded.
 */
export async function clinicianNamesOnNotes(userId: string): Promise<{ name: string; count: number }[]> {
  const counts = new Map<string, number>()
  let last: QueryDocumentSnapshot | null = null
  for (let page = 0; page < 20; page++) {
    const base = [where('userId', '==', userId), orderBy('updatedAt', 'desc')] as const
    const q: Query = last
      ? query(collection(db, 'progress_notes'), ...base, startAfter(last), queryLimit(RENAME_PAGE))
      : query(collection(db, 'progress_notes'), ...base, queryLimit(RENAME_PAGE))
    const snap: QuerySnapshot = await getDocsFromServer(q)
    snap.docs.forEach(d => {
      const name = String(d.get('clinician') ?? '').trim()
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    })
    if (snap.size < RENAME_PAGE) break
    last = snap.docs[snap.docs.length - 1]
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

/** Renames the clinician on every note saved under `from`. Returns how many changed. */
export async function renameClinicianInNotes(userId: string, from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 0
  let total = 0
  // Each pass moves its notes off `from`, so the next query finds the rest.
  // The pass limit only guards against a loop that somehow stops progressing.
  for (let pass = 0; pass < 50; pass++) {
    const snap = await getDocsFromServer(notesByClinician(userId, from))
    if (snap.empty) break
    const batch = writeBatch(db)
    // updatedAt is left alone: a rename is not an edit, and bumping it would
    // pull every old note to the top of the most-recently-updated list.
    snap.docs.forEach(d => batch.update(d.ref, { clinician: to }))
    await batch.commit()
    total += snap.size
    if (snap.size < RENAME_PAGE) break
  }
  return total
}

export async function deleteAllUserNotes(userId: string): Promise<void> {
  const q = query(
    collection(db, 'progress_notes'),
    where('userId', '==', userId),
    queryLimit(500)
  )
  const snap = await getDocs(q)
  const batch = writeBatch(db)
  snap.docs.forEach(d => batch.delete(d.ref))
  await batch.commit()
}
