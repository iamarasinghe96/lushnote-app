import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { createHmac, timingSafeEqual } from 'crypto'
import type { LifecycleEmailType } from '@/lib/emails/lifecycle'

// Who is due which email, recorded so nothing is ever sent twice. A daily job
// with no send log would re-send the same reminder every morning forever.

const DAY = 24 * 60 * 60 * 1000
export const APP_SETUP_AFTER_DAYS = 7
export const INACTIVE_AFTER_DAYS = 7

export interface Candidate {
  uid: string
  email: string
  displayName: string
  type: LifecycleEmailType
  reason: string        // what put them in this cohort, shown in the admin panel
}

interface ProfileRow {
  uid: string
  email?: string
  displayName?: string
  status?: string
  geminiApiKey?: string
  groqApiKey?: string
  onboardingComplete?: boolean
  emailOptOut?: boolean
  lifecycleEmails?: Partial<Record<LifecycleEmailType, number>>
  geminiUsage?: Record<string, { date?: string }>
  createdAt?: { toMillis?: () => number }
}

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

// Last day the doctor actually generated something. geminiUsage keeps only the
// most recent day per model, which is exactly the signal needed here.
function lastUsedMs(p: ProfileRow): number | null {
  const dates = Object.values(p.geminiUsage ?? {})
    .map(u => (u?.date ? Date.parse(`${u.date}T00:00:00Z`) : NaN))
    .filter(n => !Number.isNaN(n))
  return dates.length ? Math.max(...dates) : null
}

export async function findCandidates(now = Date.now()): Promise<Candidate[]> {
  const snap = await adminDb().collection('users').limit(5000).get()
  const out: Candidate[] = []

  for (const doc of snap.docs) {
    const p = { uid: doc.id, ...(doc.data() as Omit<ProfileRow, 'uid'>) }
    // Never mail a suspended account, an opted-out doctor, or a record with no
    // address on it.
    if (!p.email || p.status === 'disabled' || p.emailOptOut) continue

    const sent = p.lifecycleEmails ?? {}
    const createdAt = millis(p.createdAt)
    const hasKey = !!(p.geminiApiKey?.trim() || p.groqApiKey?.trim())

    if (!sent.welcome) {
      out.push({ uid: p.uid, email: p.email, displayName: p.displayName ?? '', type: 'welcome', reason: 'no welcome sent yet' })
      continue   // one email per doctor per run; the reminders can wait a day
    }

    const ageDays = createdAt ? Math.floor((now - createdAt) / DAY) : 0

    if (!hasKey && !sent.apiSetup && createdAt && ageDays >= APP_SETUP_AFTER_DAYS) {
      out.push({ uid: p.uid, email: p.email, displayName: p.displayName ?? '', type: 'apiSetup', reason: `${ageDays}d since signup, no API key` })
      continue
    }

    if (hasKey && !sent.inactive) {
      const used = lastUsedMs(p)
      const idleFrom = used ?? createdAt
      if (idleFrom && now - idleFrom >= INACTIVE_AFTER_DAYS * DAY) {
        const idleDays = Math.floor((now - idleFrom) / DAY)
        out.push({
          uid: p.uid, email: p.email, displayName: p.displayName ?? '', type: 'inactive',
          reason: used ? `${idleDays}d since last note` : `${idleDays}d since signup, never used`,
        })
      }
    }
  }
  return out
}

// The welcome for one doctor, if they are due it. Same eligibility rules as the
// nightly sweep so the two can never disagree.
export async function welcomeCandidate(uid: string): Promise<Candidate | null> {
  const snap = await adminDb().collection('users').doc(uid).get()
  if (!snap.exists) return null
  const p = snap.data() as ProfileRow
  if (!p.email || p.status === 'disabled' || p.emailOptOut) return null
  if (p.lifecycleEmails?.welcome) return null
  return { uid, email: p.email, displayName: p.displayName ?? '', type: 'welcome', reason: 'signed up' }
}

export async function markSent(uid: string, type: LifecycleEmailType, at = Date.now()): Promise<void> {
  await adminDb().collection('users').doc(uid).set(
    { lifecycleEmails: { [type]: at } },
    { merge: true },
  )
}

export interface EmailLogRow {
  uid: string
  email: string
  type: LifecycleEmailType
  subject: string
  ok: boolean
  error?: string | null
  at: number
}

// Append-only record of what actually went out, read only by the admin console
// (the Firestore catch-all already denies clients).
export async function logEmail(row: EmailLogRow): Promise<void> {
  try {
    await adminDb().collection('email_log').add({ ...row, createdAt: FieldValue.serverTimestamp() })
  } catch { /* the send already happened; bookkeeping must not undo it */ }
}

export async function recentEmailLog(limit = 100): Promise<(EmailLogRow & { id: string })[]> {
  const snap = await adminDb().collection('email_log').orderBy('createdAt', 'desc').limit(limit).get()
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as EmailLogRow) }))
}

// A signed opt-out link the doctor can use without signing in. HMAC over the uid
// with the app's admin secret — no database lookup, and it cannot be forged for
// someone else's account.
function unsubscribeSecret(): string {
  return process.env.CRON_SECRET || process.env.ADMIN_UID || 'lushnote'
}

export function unsubscribeToken(uid: string): string {
  return createHmac('sha256', unsubscribeSecret()).update(uid).digest('hex').slice(0, 32)
}

export function unsubscribeValid(uid: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(uid))
  const given = Buffer.from((token || '').slice(0, 32).padEnd(32, ' '))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

export function unsubscribeUrl(uid: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://lushnote.com.au'
  return `${base}/unsubscribe?u=${encodeURIComponent(uid)}&t=${unsubscribeToken(uid)}`
}

export async function setEmailOptOut(uid: string, optOut: boolean): Promise<void> {
  await adminDb().collection('users').doc(uid).set({ emailOptOut: optOut }, { merge: true })
}
