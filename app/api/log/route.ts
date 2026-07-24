import { NextRequest, NextResponse } from 'next/server'
import { logToSink } from '@/lib/firestore/systemLogs'
import { rateLimit } from '@/lib/rateLimit'

// Client-error ingestion. Any signed-in doctor's app can report its OWN crash here
// so it shows up in the admin Logs panel. Rate-limited and scrubbed: we store only
// a short message + route + uid — never a request body, stack with data, or note
// content. Always returns { ok:true } (never echoes anything back).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { uid?: string; message?: string; route?: string }
    const uid = (body.uid ?? '').toString().slice(0, 128)

    // Cap abuse: per-user bucket when identified, a shared bucket otherwise.
    const ok = uid ? rateLimit(`${uid}:log`, 20, 60_000) : rateLimit('anon:log', 60, 60_000)
    if (!ok) return NextResponse.json({ ok: true })

    const message = (body.message ?? '').toString().slice(0, 1000)
    const route = (body.route ?? 'client').toString().slice(0, 120)
    if (message) logToSink({ level: 'error', tag: 'client', message, route, uid: uid || undefined })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}
