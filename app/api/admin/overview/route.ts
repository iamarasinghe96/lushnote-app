import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { writeAudit, logToSink } from '@/lib/firestore/systemLogs'
import { NOTES_LIST_WARN_AT } from '@/lib/notesListLimit'

const TICKET_STATUSES = ['open', 'resolved', 'closed'] as const

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

/**
 * The busiest doctor's note count, and how many doctors are at or past the
 * warning line. Count aggregations only: no note is read. One count per doctor
 * is cheap at this size; past 1,000 doctors this wants a stored counter.
 */
async function notesPerDoctor(db: FirebaseFirestore.Firestore): Promise<{ max: number; near: number }> {
  const users = await db.collection('users').select().limit(1000).get()
  const counts = await Promise.all(users.docs.map(u =>
    db.collection('progress_notes').where('userId', '==', u.id).count().get().then(s => s.data().count)))
  return { max: counts.length ? Math.max(...counts) : 0, near: counts.filter(c => c >= NOTES_LIST_WARN_AT).length }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: 'stats' | 'deletionFeedback' | 'tickets' | 'setTicketStatus'; id?: string; status?: string }
    const admin = await requireAdmin(req).catch(() => null)
    if (!admin) return unauthorized()
    const db = adminDb()

    if (body.action === 'stats') {
      const [users, notes, pendingReq, tickets] = await Promise.all([
        db.collection('users').count().get().then(s => s.data().count).catch(() => -1),
        db.collection('progress_notes').count().get().then(s => s.data().count).catch(() => -1),
        db.collection('letterheadRequests').where('status', '==', 'pending').count().get().then(s => s.data().count).catch(() => -1),
        db.collection('support_tickets').where('status', '==', 'open').count().get().then(s => s.data().count).catch(() => -1),
      ])
      const perDoctor = await notesPerDoctor(db).catch(() => null)
      return NextResponse.json({ stats: {
        users, notes, pendingLetterheadRequests: pendingReq, openTickets: tickets,
        mostNotesOneDoctor: perDoctor ? perDoctor.max : -1,
        doctorsNearNoteLimit: perDoctor ? perDoctor.near : -1,
      } })
    }

    if (body.action === 'setTicketStatus') {
      const id = (body.id ?? '').toString()
      const status = (body.status ?? '').toString()
      if (!id || !(TICKET_STATUSES as readonly string[]).includes(status)) {
        return NextResponse.json({ error: 'Invalid ticket or status' }, { status: 400 })
      }
      await db.collection('support_tickets').doc(id).set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      await writeAudit({ actorUid: admin.uid, action: 'ticket.setStatus', meta: { id, status } })
      return NextResponse.json({ success: true })
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
      const snap = await db.collection('support_tickets').limit(500).get()
      const items = snap.docs
        .map(d => {
          const x = d.data()
          return { id: d.id, uid: x.uid ?? '', name: x.name ?? '', email: x.email ?? '', ticket: x.ticket ?? null, topic: x.topic ?? null, status: x.status ?? 'open', createdAt: millis(x.createdAt), updatedAt: millis(x.updatedAt) }
        })
        .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
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
