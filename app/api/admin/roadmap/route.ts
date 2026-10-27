import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized, ownerUid } from '@/lib/adminGuard'
import { isOwner } from '@/lib/adminAccess'
import { logToSink } from '@/lib/firestore/systemLogs'
import {
  applyStepOp, backlogIdeas, clean, cleanNotes, isStatus, parseBacklog, LIMITS,
  type Person, type RoadmapItem, type RoadmapStep, type StepOp,
} from '@/lib/roadmap'
import { STARTER } from '@/lib/roadmapStarter'
import BACKLOG_MD from '@/docs/ROADMAP.md'

// The shared roadmap on the admin console's landing page (lib/roadmap.ts).
// Every admin can read and change all of it; that is the point of it.

export const runtime = 'nodejs'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

function person(v: unknown): Person | null {
  const p = v as Partial<Person> | null
  return p && typeof p.uid === 'string' ? { uid: p.uid, name: typeof p.name === 'string' ? p.name : '' } : null
}

function toItem(id: string, x: Record<string, unknown>): RoadmapItem {
  const steps = Array.isArray(x.steps) ? x.steps as Record<string, unknown>[] : []
  return {
    id,
    title: typeof x.title === 'string' ? x.title : '',
    notes: typeof x.notes === 'string' ? x.notes : '',
    theme: typeof x.theme === 'string' ? x.theme : '',
    status: isStatus(x.status) ? x.status : 'todo',
    owner: person(x.owner),
    order: typeof x.order === 'number' ? x.order : 0,
    steps: steps.map(s => ({
      id: String(s.id ?? ''), text: String(s.text ?? ''), done: s.done === true, owner: person(s.owner),
    })),
    updatedAt: millis(x.updatedAt),
    updatedBy: typeof x.updatedBy === 'string' ? x.updatedBy : '',
    ...(typeof x.backlogId === 'string' ? { backlogId: x.backlogId } : {}),
  }
}

export async function POST(req: NextRequest) {
  try {
    let admin
    try { admin = await requireAdmin(req) } catch { return unauthorized() }
    // The name shown against what someone took or changed. Google accounts
    // carry a display name; an email-only account falls back to its address.
    const me: Person = { uid: admin.uid, name: clean(admin.name ?? admin.email ?? 'Admin', 60) }

    const body = await req.json() as Record<string, unknown>
    const col = adminDb().collection('roadmap')
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: me.name }

    if (body.action === 'list') {
      const snap = await col.limit(1000).get()
      return NextResponse.json({ items: snap.docs.map(d => toItem(d.id, d.data())), me })
    }

    // The starter items, then every open idea from the research backlog
    // (docs/ROADMAP.md). Adds only what is not there yet, so pressing it again
    // after the backlog grows brings in just the new rows, and nothing anyone
    // edited, finished or deleted comes back changed. A deleted suggestion does
    // come back; mark it Done instead to keep it out of the way.
    if (body.action === 'addSuggested') {
      const existing = await col.select('starterKey', 'backlogId', 'title').get()
      const keys = new Set(existing.docs.map(d => d.get('starterKey')).filter(Boolean))
      const ids = new Set(existing.docs.map(d => d.get('backlogId')).filter(Boolean))
      // Starter items added before they carried a key are matched by title.
      const titles = new Set(existing.docs.map(d => d.get('title')))
      const owner = isOwner(admin.uid, ownerUid())
      const writes: Record<string, unknown>[] = []
      STARTER.forEach((s, i) => {
        if (keys.has(s.key) || titles.has(s.title)) return
        writes.push({
          starterKey: s.key, title: s.title, theme: s.theme, notes: s.notes, status: 'todo', order: (i + 1) * 10,
          owner: s.ownerItem && owner ? me : null,
          steps: s.steps.map(text => ({ id: randomUUID(), text, done: false, owner: null })),
        })
      })
      for (const idea of backlogIdeas(parseBacklog(BACKLOG_MD))) {
        if (ids.has(idea.backlogId)) continue
        writes.push({ ...idea, status: 'idea', owner: null, steps: [] })
      }
      // A batch takes at most 500 writes.
      for (let i = 0; i < writes.length; i += 400) {
        const batch = adminDb().batch()
        for (const w of writes.slice(i, i + 400)) batch.set(col.doc(), { ...w, ...stamp })
        await batch.commit()
      }
      return NextResponse.json({ added: writes.length })
    }

    if (body.action === 'create') {
      const title = clean(body.title, LIMITS.title)
      if (!title) return NextResponse.json({ error: 'Give it a title.' }, { status: 400 })
      const last = await col.orderBy('order', 'desc').limit(1).get()
      const order = last.empty ? 10 : ((last.docs[0].get('order') as number) ?? 0) + 10
      const ref = await col.add({
        title, theme: clean(body.theme, LIMITS.theme), notes: '', status: 'todo', order, owner: null, steps: [], ...stamp,
      })
      return NextResponse.json({ id: ref.id })
    }

    const id = typeof body.id === 'string' ? body.id : ''
    if (!ID_RE.test(id)) return NextResponse.json({ error: 'Invalid item' }, { status: 400 })
    const ref = col.doc(id)

    if (body.action === 'update') {
      const patch: Record<string, unknown> = {}
      if ('title' in body) {
        const title = clean(body.title, LIMITS.title)
        if (!title) return NextResponse.json({ error: 'The title cannot be empty.' }, { status: 400 })
        patch.title = title
      }
      if ('notes' in body) patch.notes = cleanNotes(body.notes)
      if ('theme' in body) patch.theme = clean(body.theme, LIMITS.theme)
      if ('status' in body) {
        if (!isStatus(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        patch.status = body.status
      }
      if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
      await ref.update({ ...patch, ...stamp })
      return NextResponse.json({ success: true })
    }

    // Taking an item someone else holds is refused: they release it first, so
    // nobody's work is reassigned behind their back.
    if (body.action === 'take' || body.action === 'release') {
      const refusal = await adminDb().runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists) return 'That item no longer exists.'
        const current = person(snap.get('owner'))
        if (body.action === 'take' && current && current.uid !== me.uid) return `${current.name || 'Someone'} has already taken this.`
        // Taking an idea is deciding to do it.
        const promote = body.action === 'take' && snap.get('status') === 'idea' ? { status: 'todo' } : {}
        tx.update(ref, { owner: body.action === 'take' ? me : null, ...promote, ...stamp })
        return null
      })
      if (refusal) return NextResponse.json({ error: refusal }, { status: 409 })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'step') {
      const raw = body.step as Record<string, unknown> | undefined
      const op = (raw?.op === 'add' ? { op: 'add', text: raw.text, id: randomUUID() } : raw) as StepOp | undefined
      if (!op || !['add', 'toggle', 'edit', 'take', 'release', 'remove'].includes(op.op)) {
        return NextResponse.json({ error: 'Invalid step change' }, { status: 400 })
      }
      const ok = await adminDb().runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (!snap.exists) return false
        const next = applyStepOp(toItem(id, snap.data() ?? {}).steps, op, me)
        if (!next) return false
        tx.update(ref, { steps: next as RoadmapStep[], ...stamp })
        return true
      })
      if (!ok) return NextResponse.json({ error: 'That step changed in the meantime. Refreshed.' }, { status: 409 })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'delete') {
      await ref.delete()
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    logToSink({ level: 'error', tag: 'admin/roadmap', message: msg, route: '/api/admin/roadmap', status: 500 })
    return NextResponse.json({ error: 'Could not update the roadmap. Please try again.' }, { status: 500 })
  }
}
