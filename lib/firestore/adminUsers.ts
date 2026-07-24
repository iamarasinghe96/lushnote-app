import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { adminAuth } from '@/lib/firebase-admin-auth'
import { writeAudit } from '@/lib/firestore/systemLogs'
import type { Query } from 'firebase-admin/firestore'

// The ONLY fields an admin may see about a doctor. Built by explicit allow-list
// (never a spread), so secrets can never leak: groqApiKey, geminiApiKey,
// signatureUrl, and the free-text emailPretext/personalisation are omitted by
// construction. Note/patient data is NEVER read here — only counts (below).
export interface AdminUserRow {
  uid: string
  email: string
  displayName: string
  credentials: string
  status: string
  tier: string
  position?: string
  workPhone?: string
  workplaces: { name: string; type: string }[]
  onboardingComplete: boolean
  termsAccepted: boolean
  marketingConsent: boolean
  geminiUsage: unknown
  createdAt: number | null
  updatedAt: number | null
}

export interface AdminUserDetail extends AdminUserRow {
  noteCount: number
  patientCount: number
  authDisabled: boolean | null
  lastSignIn: number | null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

export function redactUser(uid: string, d: Record<string, unknown>): AdminUserRow {
  const wps = Array.isArray(d.workplaces)
    ? (d.workplaces as Record<string, unknown>[]).map(w => ({ name: str(w?.name), type: str(w?.type) }))
    : []
  return {
    uid,
    email: str(d.email),
    displayName: str(d.displayName),
    credentials: str(d.credentials),
    status: str(d.status) || 'active',
    tier: str(d.tier) || 'free',
    position: str(d.position) || undefined,
    workPhone: str(d.workPhone) || undefined,
    workplaces: wps,
    onboardingComplete: d.onboardingComplete === true,
    termsAccepted: d.termsAccepted === true,
    marketingConsent: d.marketingConsent === true,
    geminiUsage: d.geminiUsage ?? null,
    createdAt: millis(d.createdAt),
    updatedAt: millis(d.updatedAt),
  }
}

// List doctors (redacted). Fetch a bounded window and sort newest-first in memory
// so docs missing createdAt aren't dropped by an orderBy.
export async function listAdminUsers(cap = 2000): Promise<AdminUserRow[]> {
  const snap = await adminDb().collection('users').limit(cap).get()
  return snap.docs
    .map(d => redactUser(d.id, d.data()))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

// Per-user aggregates — COUNTS ONLY, never content. Both are single aggregate
// queries with one equality filter (no composite index needed).
async function countNotes(uid: string): Promise<number> {
  try { return (await adminDb().collection('progress_notes').where('userId', '==', uid).count().get()).data().count }
  catch { return -1 }
}
async function countPatients(uid: string): Promise<number> {
  try { return (await adminDb().collection('users').doc(uid).collection('patientProfiles').count().get()).data().count }
  catch { return -1 }
}

export async function detailAdminUser(uid: string): Promise<AdminUserDetail | null> {
  const doc = await adminDb().collection('users').doc(uid).get()
  const base = doc.exists ? redactUser(uid, doc.data() as Record<string, unknown>) : null
  const [noteCount, patientCount, authRec] = await Promise.all([
    countNotes(uid),
    countPatients(uid),
    adminAuth().getUser(uid).catch(() => null),
  ])
  // If there's no Firestore doc but the Auth account exists (signed up, never
  // onboarded), synthesize a minimal row from Auth so it's still visible.
  const row: AdminUserRow = base ?? {
    uid, email: authRec?.email ?? '', displayName: authRec?.displayName ?? '', credentials: '',
    status: 'pending', tier: 'free', workplaces: [], onboardingComplete: false,
    termsAccepted: false, marketingConsent: false, geminiUsage: null,
    createdAt: authRec?.metadata?.creationTime ? Date.parse(authRec.metadata.creationTime) : null, updatedAt: null,
  }
  return {
    ...row,
    noteCount, patientCount,
    authDisabled: authRec ? authRec.disabled : null,
    lastSignIn: authRec?.metadata?.lastSignInTime ? Date.parse(authRec.metadata.lastSignInTime) : null,
  }
}

async function deleteQueryChunked(q: Query, chunk = 400): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await q.limit(chunk).get()
    if (snap.empty) break
    const batch = adminDb().batch()
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
    if (snap.size < chunk) break
  }
}

// Suspend (disable sign-in) or reactivate. Sets the Firestore status flag AND the
// Auth `disabled` flag so a suspended doctor can't authenticate.
export async function setUserSuspended(uid: string, suspended: boolean, actorUid: string): Promise<void> {
  await adminDb().collection('users').doc(uid).set({ status: suspended ? 'disabled' : 'active' }, { merge: true })
  await adminAuth().updateUser(uid, { disabled: suspended }).catch(() => {})
  await writeAudit({ actorUid, action: suspended ? 'user.suspend' : 'user.reactivate', targetUid: uid })
}

// Delete only the user's Storage objects (signatures/recordings/letterhead assets).
export async function clearUserStorage(uid: string, actorUid: string): Promise<void> {
  const bucket = adminStorage().bucket()
  await Promise.all([
    bucket.deleteFiles({ prefix: `signatures/${uid}/` }).catch(() => {}),
    bucket.deleteFiles({ prefix: `recordings/${uid}/` }).catch(() => {}),
    bucket.deleteFiles({ prefix: `letterhead-requests/${uid}/` }).catch(() => {}),
  ])
  await writeAudit({ actorUid, action: 'user.clearStorage', targetUid: uid })
}

// Complete cascade: every user-owned Firestore path + Storage prefix + the Auth
// account. Idempotent and partial-failure safe. Never touches shared config
// (letterheads/* , hospitalForms/*).
export async function cascadeDeleteUser(uid: string, actorUid: string, meta: Record<string, string | number | boolean | null>): Promise<void> {
  const db = adminDb()
  await deleteQueryChunked(db.collection('progress_notes').where('userId', '==', uid))
  await deleteQueryChunked(db.collection('users').doc(uid).collection('patientProfiles'))
  await deleteQueryChunked(db.collection('users').doc(uid).collection('transcriptDrafts'))
  await db.collection('deletion_feedback').doc(uid).delete().catch(() => {})
  await db.collection('support_threads').doc(uid).delete().catch(() => {})
  await deleteQueryChunked(db.collection('support_tickets').where('uid', '==', uid))
  await deleteQueryChunked(db.collection('letterheadRequests').where('requestedBy', '==', uid))
  await db.collection('users').doc(uid).delete().catch(() => {})
  await clearUserStorageRaw(uid)
  await adminAuth().deleteUser(uid).catch(() => {})
  await writeAudit({ actorUid, action: 'user.remove', targetUid: uid, meta })
}

async function clearUserStorageRaw(uid: string): Promise<void> {
  const bucket = adminStorage().bucket()
  await Promise.all([
    bucket.deleteFiles({ prefix: `signatures/${uid}/` }).catch(() => {}),
    bucket.deleteFiles({ prefix: `recordings/${uid}/` }).catch(() => {}),
    bucket.deleteFiles({ prefix: `letterhead-requests/${uid}/` }).catch(() => {}),
  ])
}
