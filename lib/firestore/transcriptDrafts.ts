'use client'

import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

// A single in-progress recording draft per user. The segmented recorder appends
// each transcribed segment here as it completes, so an interrupted recording
// (crash, closed tab, network drop, function timeout) never loses the portion
// already transcribed — it is recoverable on the next app load.
const DRAFT_ID = 'current'

export interface TranscriptDraft {
  text: string
  mode: string
  letterType: string | null
  durationSec: number
  updatedAt?: unknown
}

export async function saveTranscriptDraft(
  uid: string,
  data: { text: string; mode: string; letterType: string | null; durationSec: number },
): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

export async function getTranscriptDraft(uid: string): Promise<TranscriptDraft | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID))
  return snap.exists() ? (snap.data() as TranscriptDraft) : null
}

export async function deleteTranscriptDraft(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID)).catch(() => {})
}
