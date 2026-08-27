'use client'

import { doc, setDoc, getDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { DraftHandoff } from '@/lib/draftHandoff'

// A single in-progress recording draft per user. The segmented recorder appends
// each transcribed segment here as it completes, so an interrupted recording
// (crash, closed tab, network drop, function timeout) never loses the portion
// already transcribed — it is recoverable on the next app load. It also carries
// a per-segment diagnostic log (metadata only, no clinical text) so a failure
// leaves a real record of which segment failed and why.
const DRAFT_ID = 'current'

export interface SegmentLogEntry {
  seg: number
  ok: boolean
  provider?: string
  chars?: number
  ms: number
  error?: string
}

export interface TranscriptDraft {
  text: string
  mode: string
  letterType: string | null
  durationSec: number
  segmentLog?: SegmentLogEntry[]
  /** Patient + template the doctor supplied after the recording stopped. Absent
   *  on a draft written by the recorder alone. See lib/draftHandoff. */
  handoff?: unknown
  updatedAt?: unknown
}

export async function saveTranscriptDraft(
  uid: string,
  data: { text: string; mode: string; letterType: string | null; durationSec: number; segmentLog?: SegmentLogEntry[] },
): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

/**
 * Merge the patient/template handoff into the draft the recorder is already
 * writing. Separate from saveTranscriptDraft because the two have different
 * writers and cadences — the recorder appends text every 4 minutes, this runs
 * once when the doctor names the patient and again when they pick a template —
 * and a merge write keeps either from overwriting the other's fields.
 *
 * Never throws: this is a safety net, and a doctor must not be blocked from
 * their note because the net could not be written.
 */
export async function saveDraftHandoff(uid: string, handoff: DraftHandoff): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID),
    { handoff, updatedAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {})
}

export async function getTranscriptDraft(uid: string): Promise<TranscriptDraft | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID))
  return snap.exists() ? (snap.data() as TranscriptDraft) : null
}

export async function deleteTranscriptDraft(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'transcriptDrafts', DRAFT_ID)).catch(() => {})
}
