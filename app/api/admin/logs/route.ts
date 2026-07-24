import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'

// Serialize a Firestore Timestamp to millis for the client (null-safe).
function ts(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: 'listLogs' | 'listAudit'; limit?: number }
    try { await requireAdmin(req) } catch { return unauthorized() }

    const db = adminDb()
    // Single orderBy, no equality filters — avoids composite-index requirements.
    // The panel filters the returned window client-side (level/route/uid/search).
    const limit = Math.min(Math.max(body.limit ?? 200, 1), 500)

    if (body.action === 'listLogs') {
      const snap = await db.collection('system_logs').orderBy('createdAt', 'desc').limit(limit).get()
      const logs = snap.docs.map(d => {
        const x = d.data()
        return { id: d.id, level: x.level, tag: x.tag, message: x.message, route: x.route, status: x.status ?? null, uid: x.uid ?? null, createdAt: ts(x.createdAt) }
      })
      return NextResponse.json({ logs })
    }

    if (body.action === 'listAudit') {
      const snap = await db.collection('admin_audit').orderBy('createdAt', 'desc').limit(limit).get()
      const audit = snap.docs.map(d => {
        const x = d.data()
        return { id: d.id, actorUid: x.actorUid, action: x.action, targetUid: x.targetUid ?? null, meta: x.meta ?? null, createdAt: ts(x.createdAt) }
      })
      return NextResponse.json({ audit })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    console.error('[admin/logs]', msg)
    logToSink({ level: 'error', tag: 'admin/logs', message: msg, route: '/api/admin/logs', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
