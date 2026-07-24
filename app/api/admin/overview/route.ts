import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: 'stats' | 'deletionFeedback' | 'tickets' }
    try { await requireAdmin(req) } catch { return unauthorized() }
    const db = adminDb()

    if (body.action === 'stats') {
      const [users, notes, pendingReq, tickets] = await Promise.all([
        db.collection('users').count().get().then(s => s.data().count).catch(() => -1),
        db.collection('progress_notes').count().get().then(s => s.data().count).catch(() => -1),
        db.collection('letterheadRequests').where('status', '==', 'pending').count().get().then(s => s.data().count).catch(() => -1),
        db.collection('support_threads').count().get().then(s => s.data().count).catch(() => -1),
      ])
      return NextResponse.json({ stats: { users, notes, pendingLetterheadRequests: pendingReq, openTickets: tickets } })
    }

    if (body.action === 'deletionFeedback') {
      const snap = await db.collection('deletion_feedback').orderBy('deletedAt', 'desc').limit(200).get()
      const items = snap.docs.map(d => {
        const x = d.data()
        return { id: d.id, email: x.email ?? '', reasons: Array.isArray(x.reasons) ? x.reasons : [], message: x.message ?? '', deletedAt: millis(x.deletedAt) }
      })
      return NextResponse.json({ items })
    }

    if (body.action === 'tickets') {
      const snap = await db.collection('support_threads').limit(200).get()
      const items = snap.docs.map(d => {
        const x = d.data()
        return { uid: d.id, name: x.name ?? '', email: x.email ?? '', ticket: x.ticket ?? null, topic: x.topic ?? null }
      })
      return NextResponse.json({ items })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    console.error('[admin/overview]', msg)
    logToSink({ level: 'error', tag: 'admin/overview', message: msg, route: '/api/admin/overview', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
