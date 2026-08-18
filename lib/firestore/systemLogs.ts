import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { currentRequest, elapsedMs } from '@/lib/requestContext'

// In-app log/error sink + admin audit trail. Read only through the admin API;
// the Firestore catch-all rule already denies all client access to these
// collections, and they are written only via the Admin SDK.

export type LogLevel = 'error' | 'warn' | 'info'

export interface LogEntry {
  level: LogLevel
  tag: string          // area tag, e.g. 'support', 'generate'
  message: string      // an err.message string — NEVER a request body / raw error / note content
  route: string        // e.g. '/api/support'
  status?: number      // HTTP status returned, when relevant
  uid?: string         // pseudonymous caller id (linkable identifier, not PHI)
  // Everything below is filled in automatically from the request context when
  // omitted, so no call site has to remember it.
  requestId?: string   // ties one doctor's click to every line it produced
  mode?: string        // 'patient-intake', 'letter', 'note', 'hospital-form' …
  ms?: number          // how long the request had been running
}

// Which build produced the line. "Is the fix live yet?" was asked twice in one
// evening and could not be answered from a log, only guessed at from a
// timestamp. Vercel exposes the commit on every deployment.
const RELEASE = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7)

// Errors are the ones where a doctor was actually blocked. Warnings are things
// that recovered — a busy model, a retried extraction — and alerting on those
// would train the alert to be ignored.
const OPS_WEBHOOK = process.env.SLACK_WEBHOOK ?? ''
// Per warm instance, so a burst from one broken deploy sends once rather than
// once per request. Deliberately not shared state: missing a duplicate costs
// nothing, and a cross-instance store would put a database read on the failure
// path, which is the worst possible moment to add one.
const alerted = new Map<string, number>()
const ALERT_WINDOW_MS = 10 * 60 * 1000

function alertOps(entry: LogEntry, requestId: string): void {
  if (!OPS_WEBHOOK) return
  const key = `${entry.tag}:${(entry.message || '').slice(0, 80)}`
  const now = Date.now()
  const last = alerted.get(key) ?? 0
  if (now - last < ALERT_WINDOW_MS) return
  alerted.set(key, now)
  const lines = [
    `*LushNote — a doctor was blocked*`,
    `\`${entry.tag}\` on \`${entry.route}\`${entry.mode ? ` (${entry.mode})` : ''}`,
    entry.message,
    [requestId ? `request \`${requestId}\`` : '', entry.uid ? `uid \`${entry.uid}\`` : '', RELEASE ? `build \`${RELEASE}\`` : '']
      .filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n')
  fetch(OPS_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines }),
  }).catch(() => {})
}

// Fire-and-forget append to `system_logs`. PHI-safe BY CONTRACT: only short scalar
// fields are stored — callers must pass an err.message string, never the request
// body, a serialized error object, or any note/patient content. Never throws.
export function logToSink(entry: LogEntry): void {
  try {
    const ctx = currentRequest()
    const requestId = entry.requestId ?? ctx?.requestId ?? ''
    const mode = entry.mode ?? ctx?.mode ?? ''
    const uid = entry.uid ?? ctx?.uid ?? ''
    const ms = entry.ms ?? elapsedMs()
    adminDb().collection('system_logs').add({
      level: entry.level,
      tag: (entry.tag || '').slice(0, 80),
      message: (entry.message || '').slice(0, 2000),
      route: (entry.route || ctx?.route || '').slice(0, 120),
      status: typeof entry.status === 'number' ? entry.status : null,
      uid: uid ? uid.slice(0, 128) : null,
      requestId: requestId || null,
      mode: mode ? mode.slice(0, 40) : null,
      ms: typeof ms === 'number' ? ms : null,
      release: RELEASE || null,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
    if (entry.level === 'error') alertOps({ ...entry, mode, uid }, requestId)
  } catch { /* logging must never break the request path */ }
}

export interface AuditEntry {
  actorUid: string
  action: string
  targetUid?: string
  meta?: Record<string, string | number | boolean | null>  // small, non-PHI context only
}

// Append-only admin audit trail. Awaited so a destructive action's record is
// durable before the response returns. Never throws.
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await adminDb().collection('admin_audit').add({
      actorUid: (entry.actorUid || '').slice(0, 128),
      action: (entry.action || '').slice(0, 80),
      targetUid: entry.targetUid ? entry.targetUid.slice(0, 128) : null,
      meta: entry.meta ?? null,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch { /* audit write is best-effort; never blocks the action */ }
}
