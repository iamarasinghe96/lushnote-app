import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'
import { listAdminUsers, detailAdminUser, setUserSuspended, clearUserStorage, cascadeDeleteUser } from '@/lib/firestore/adminUsers'

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: string; uid?: string; confirmEmail?: string }
    let admin
    try { admin = await requireAdmin(req) } catch { return unauthorized() }

    const { action } = body

    if (action === 'list') {
      return NextResponse.json({ users: await listAdminUsers() })
    }

    if (action === 'export') {
      // Marketing export: consented users only, non-sensitive columns only.
      const rows = (await listAdminUsers())
        .filter(u => u.marketingConsent)
        .map(u => ({ displayName: u.displayName, email: u.email, workplace: u.workplaces[0]?.name ?? '' }))
      return NextResponse.json({ users: rows })
    }

    // All remaining actions target a specific uid.
    const uid = (body.uid ?? '').toString()
    if (!UID_RE.test(uid)) return NextResponse.json({ error: 'Invalid uid' }, { status: 400 })

    if (action === 'detail') {
      const detail = await detailAdminUser(uid)
      if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ user: detail })
    }

    if (action === 'suspend' || action === 'reactivate') {
      await setUserSuspended(uid, action === 'suspend', admin.uid)
      return NextResponse.json({ success: true })
    }

    if (action === 'clearStorage') {
      await clearUserStorage(uid, admin.uid)
      return NextResponse.json({ success: true })
    }

    if (action === 'remove') {
      // Step-up confirmation: the typed email must match the target's email.
      const detail = await detailAdminUser(uid)
      if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const confirm = (body.confirmEmail ?? '').toString().trim().toLowerCase()
      if (!detail.email || confirm !== detail.email.toLowerCase()) {
        return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
      }
      await cascadeDeleteUser(uid, admin.uid, { email: detail.email, noteCount: detail.noteCount, patientCount: detail.patientCount })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    console.error('[admin/users]', msg)
    logToSink({ level: 'error', tag: 'admin/users', message: msg, route: '/api/admin/users', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
