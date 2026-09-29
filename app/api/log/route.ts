import { NextRequest, NextResponse } from 'next/server'
import { logToSink } from '@/lib/firestore/systemLogs'
import { rateLimit } from '@/lib/rateLimit'
import { requireUser } from '@/lib/adminGuard'

// Client-error ingestion. Any signed-in doctor's app can report its OWN crash here
// so it shows up in the admin Logs panel. Rate-limited and scrubbed: we store only
// a short message + route + uid — never a request body, stack with data, or note
// content. Always returns { ok:true } (never echoes anything back).
//
// The uid comes from the verified token, never the body: a body uid let anyone
// file entries under any doctor's name. No token (the root error page, a crash
// before sign-in) still logs, just unattributed.
export async function POST(req: NextRequest) {
  try {
    let uid = ''
    try { uid = await requireUser(req) } catch { /* unattributed */ }

    const body = await req.json().catch(() => ({})) as { message?: string; route?: string; level?: string; tag?: string }

    // Cap abuse: per-user bucket when identified, a shared bucket otherwise.
    const limit = uid ? rateLimit(`${uid}:log`, 30, 60_000) : rateLimit('anon:log', 60, 60_000)
    if (!limit.allowed) return NextResponse.json({ ok: true })

    const level = (['error', 'warn', 'info'].includes(body.level ?? '') ? body.level : 'error') as 'error' | 'warn' | 'info'
    const tag = (body.tag ?? 'client').toString().slice(0, 80)
    const message = (body.message ?? '').toString().slice(0, 1000)
    const route = (body.route ?? 'client').toString().slice(0, 120)
    if (message) logToSink({ level, tag, message, route, uid: uid || undefined })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
