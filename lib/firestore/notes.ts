import {
  collection,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit as queryLimit,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Note, NoteInput } from '@/types'

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

export async function listNotes(userId: string, limit = 200): Promise<Note[]> {
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
