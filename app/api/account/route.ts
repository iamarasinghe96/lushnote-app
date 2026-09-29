import { NextRequest, NextResponse } from 'next/server'
import { requireUser, unauthorized } from '@/lib/adminGuard'
import { selfDeleteUser } from '@/lib/firestore/adminUsers'
import { logToSink } from '@/lib/firestore/systemLogs'

// Years of notes are deleted in batches of 400. Room for a large account; a
// timeout is still safe, because the deletion is idempotent and a retry finishes.
export const maxDuration = 300

// A doctor deleting their own account. The browser re-authenticates with Google
// first; this does the deleting, server-side, and says whether it worked. See
// selfDeleteUser for what is removed and why a failure here is reported rather
// than hidden behind the "account deleted" page.
export async function POST(req: NextRequest) {
  let uid: string
  try { uid = await requireUser(req) } catch { return unauthorized() }

  const body = await req.json().catch(() => ({})) as { action?: string }
  if (body.action !== 'delete') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  try {
    const storageLeft = await selfDeleteUser(uid)
    if (storageLeft.length) {
      // PHI-safe: which folders, never what is in them.
      logToSink({ level: 'error', tag: 'account-delete', route: '/api/account', uid, message: `deleted, but Storage not cleared (${storageLeft.join(', ')}): use Clear storage` })
    } else {
      logToSink({ level: 'info', tag: 'account-delete', route: '/api/account', uid, message: 'account deleted by its owner' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : 'unknown'
    logToSink({ level: 'error', tag: 'account-delete', route: '/api/account', uid, message: `self-delete failed part way: ${msg}`, status: 500 })
    return NextResponse.json({ error: 'Your account could not be fully deleted.' }, { status: 500 })
  }
}
