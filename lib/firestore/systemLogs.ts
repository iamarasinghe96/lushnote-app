import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

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
}

// Fire-and-forget append to `system_logs`. PHI-safe BY CONTRACT: only short scalar
// fields are stored — callers must pass an err.message string, never the request
// body, a serialized error object, or any note/patient content. Never throws.
export function logToSink(entry: LogEntry): void {
  try {
    adminDb().collection('system_logs').add({
      level: entry.level,
      tag: (entry.tag || '').slice(0, 80),
      message: (entry.message || '').slice(0, 2000),
      route: (entry.route || '').slice(0, 120),
      status: typeof entry.status === 'number' ? entry.status : null,
      uid: entry.uid ? entry.uid.slice(0, 128) : null,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => {})
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
