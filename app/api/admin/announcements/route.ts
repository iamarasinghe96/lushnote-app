import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { writeAudit, logToSink } from '@/lib/firestore/systemLogs'

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'list' | 'save' | 'delete'
      id?: string
      title?: string
      summary?: string
      details?: string
      version?: string
      published?: boolean
    }
    let admin
    try { admin = await requireAdmin(req) } catch { return unauthorized() }

    const col = adminDb().collection('announcements')

    if (body.action === 'list') {
      const snap = await col.orderBy('createdAt', 'desc').limit(200).get()
      const items = snap.docs.map(d => {
        const x = d.data()
        return { id: d.id, title: x.title ?? '', summary: x.summary ?? '', details: x.details ?? '', version: x.version ?? '', published: x.published === true, createdAt: millis(x.createdAt), publishedAt: millis(x.publishedAt) }
      })
      return NextResponse.json({ announcements: items })
    }

    if (body.action === 'save') {
      const title = (body.title ?? '').toString().trim().slice(0, 200)
      const summary = (body.summary ?? '').toString().trim().slice(0, 600)
      const details = (body.details ?? '').toString().slice(0, 8000)
      const version = (body.version ?? '').toString().trim().slice(0, 40)
      const published = body.published === true
      if (!title || !summary) return NextResponse.json({ error: 'Title and summary are required' }, { status: 400 })

      if (body.id) {
        const ref = col.doc(body.id)
        const existing = await ref.get()
        const alreadyPublished = existing.exists && existing.data()?.publishedAt
        await ref.set({
          title, summary, details, version, published,
          updatedAt: FieldValue.serverTimestamp(),
          // stamp publishedAt the first time it goes live
          ...(published && !alreadyPublished ? { publishedAt: FieldValue.serverTimestamp() } : {}),
        }, { merge: true })
        await writeAudit({ actorUid: admin.uid, action: 'announcement.update', meta: { id: body.id, published } })
        return NextResponse.json({ success: true, id: body.id })
      }

      const ref = await col.add({
        title, summary, details, version, published,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(published ? { publishedAt: FieldValue.serverTimestamp() } : {}),
      })
      await writeAudit({ actorUid: admin.uid, action: 'announcement.create', meta: { id: ref.id, published } })
      return NextResponse.json({ success: true, id: ref.id })
    }

    if (body.action === 'delete') {
      if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
      await col.doc(body.id).delete()
      await writeAudit({ actorUid: admin.uid, action: 'announcement.delete', meta: { id: body.id } })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    console.error('[admin/announcements]', msg)
    logToSink({ level: 'error', tag: 'admin/announcements', message: msg, route: '/api/admin/announcements', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
