'use client'

import { doc, collection, setDoc, getDoc, getDocs, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { DraftHandoff } from '@/lib/draftHandoff'
import { partitionDrafts, draftExpiryDate } from '@/lib/draftRetention'

// ONE DOCUMENT PER RECORDING SESSION, keyed by the recorder's session id.
//
// The segmented recorder appends each transcribed segment as it completes, so an
// interrupted recording (crash, closed tab, network drop, function timeout)
// never loses the portion already transcribed. It also carries a per-segment
// diagnostic log — metadata only, no clinical text — so a failure leaves a real
// record of which segment failed and why.
//
// This used to be a single doc called 'current'. Recording a second patient
// before the first became a note overwrote the first, silently, and because the
// write MERGED, a half-finished handoff survived onto the new transcript —
// patient B's session carrying patient A's name and reg number. Per-session
// documents make both impossible: nothing shares a key, so nothing can bleed.
//
// The cost is that abandoned drafts accumulate, and a draft is a full patient
// transcript. They expire — see lib/draftRetention.

export interface SegmentLogEntry {
  seg: number
  ok: boolean
  provider?: string
  chars?: number
  ms: number
  error?: string
}

export interface TranscriptDraft {
  /** The recorder session id this draft belongs to. */
  id: string
  text: string
  mode: string
  letterType: string | null
  durationSec: number
  segmentLog?: SegmentLogEntry[]
  /** Patient + template the doctor supplied after the recording stopped. Absent
   *  on a draft written by the recorder alone. See lib/draftHandoff. */
  handoff?: unknown
  /** Milliseconds, flattened from the Firestore Timestamp for sorting. */
  updatedAtMs?: number
}

function draftRef(uid: string, draftId: string) {
  return doc(db, 'users', uid, 'transcriptDrafts', draftId)
}

export async function saveTranscriptDraft(
  uid: string,
  draftId: string,
  data: { text: string; mode: string; letterType: string | null; durationSec: number; segmentLog?: SegmentLogEntry[] },
): Promise<void> {
  await setDoc(
    draftRef(uid, draftId),
    // expiresAt is rewritten on every save, so the clock runs from the LAST
    // activity: a recording still being added to is not abandoned.
    { ...data, updatedAt: serverTimestamp(), expiresAt: Timestamp.fromDate(draftExpiryDate()) },
    { merge: true },
  )
}

/**
 * Merge the patient/template handoff into the draft the recorder is writing.
 * Separate from saveTranscriptDraft because the two have different writers and
 * cadences — the recorder appends text every 4 minutes, this runs when the
 * doctor names the patient and again when they pick a template — and a merge
 * write keeps either from overwriting the other's fields.
 *
 * Merging is safe now that drafts are per-session: the handoff can only ever
 * land on the recording it belongs to.
 *
 * Never throws: this is a safety net, and a doctor must not be blocked from
 * their note because the net could not be written.
 */
export async function saveDraftHandoff(uid: string, draftId: string, handoff: DraftHandoff): Promise<void> {
  await setDoc(
    draftRef(uid, draftId),
    { handoff, updatedAt: serverTimestamp(), expiresAt: Timestamp.fromDate(draftExpiryDate()) },
    { merge: true },
  ).catch(() => {})
}

export async function getTranscriptDraft(uid: string, draftId: string): Promise<TranscriptDraft | null> {
  const snap = await getDoc(draftRef(uid, draftId))
  if (!snap.exists()) return null
  const d = snap.data() as Omit<TranscriptDraft, 'id'> & { updatedAt?: { toMillis?: () => number } }
  return { ...d, id: snap.id, updatedAtMs: d.updatedAt?.toMillis?.() }
}

/**
 * Every unfinished recording, newest first, with expired ones removed as a side
 * effect.
 *
 * Pruning on read rather than only by TTL policy: the policy is configured in
 * the Firebase console and cannot be relied on to exist, and a doctor who opens
 * the app is exactly when it is cheapest to tidy up. The TTL policy is still
 * worth adding — it catches the doctor who never comes back.
 */
export async function listTranscriptDrafts(uid: string): Promise<TranscriptDraft[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'transcriptDrafts'))
  const all: TranscriptDraft[] = snap.docs.map(s => {
    const d = s.data() as Omit<TranscriptDraft, 'id'> & { updatedAt?: { toMillis?: () => number } }
    return { ...d, id: s.id, updatedAtMs: d.updatedAt?.toMillis?.() }
  })
  const { live, expired } = partitionDrafts(all)
  // Best effort. A failed cleanup leaves clutter; a thrown cleanup would hide
  // the drafts the doctor came here to recover.
  for (const e of expired) void deleteTranscriptDraft(uid, e.id)
  // Only drafts with something in them are worth offering back.
  return live.filter(d => typeof d.text === 'string' && d.text.trim().length > 0)
}

export async function deleteTranscriptDraft(uid: string, draftId: string): Promise<void> {
  await deleteDoc(draftRef(uid, draftId)).catch(() => {})
}
