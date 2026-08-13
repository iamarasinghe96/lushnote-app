import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireUser, unauthorized } from '@/lib/adminGuard'
import { sendEmail, emailConfigured } from '@/lib/email'
import { buildLifecycleEmail } from '@/lib/emails/lifecycle'
import { findCandidates, markSent, logEmail, recentEmailLog, unsubscribeUrl, welcomeCandidate, type Candidate } from '@/lib/firestore/lifecycle'
import { logToSink } from '@/lib/firestore/systemLogs'

// The daily lifecycle run, plus the admin console's read-only views of it.
// Two ways in, both privileged: Vercel Cron with CRON_SECRET, or a signed-in
// admin. There is no path that lets an ordinary request send mail.
export const maxDuration = 300

// Sends are spaced so a batch can't trip Zoho's per-minute limit and get the
// mailbox throttled mid-run.
const GAP_MS = 1200
const MAX_PER_RUN = 100

function cronAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  return header === `Bearer ${secret}`
}

async function send(candidates: Candidate[], dryRun: boolean) {
  const results: { uid: string; email: string; type: string; ok: boolean; error?: string }[] = []
  for (const c of candidates.slice(0, MAX_PER_RUN)) {
    const mail = buildLifecycleEmail(c.type, c.displayName, unsubscribeUrl(c.uid))
    if (dryRun) {
      results.push({ uid: c.uid, email: c.email, type: c.type, ok: true })
      continue
    }
    const error = await sendEmail({ ...mail, to: c.email })
    const at = Date.now()
    // Marked BEFORE the log so a crash between the two re-sends nothing: a
    // doctor getting the same email twice is worse than us losing a log row.
    if (!error) await markSent(c.uid, c.type, at).catch(() => {})
    await logEmail({ uid: c.uid, email: c.email, type: c.type, subject: mail.subject, ok: !error, error: error ?? null, at })
    results.push({ uid: c.uid, email: c.email, type: c.type, ok: !error, error: error ?? undefined })
    if (!error) await new Promise(r => setTimeout(r, GAP_MS))
  }
  return results
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { action?: string; dryRun?: boolean }
    const action = body.action ?? 'run'

    // The welcome is the one email that must not wait for the nightly run — it
    // opens with "you've just signed in". Any signed-in doctor can trigger it,
    // but only ever for their own account, and only once.
    if (action === 'welcome') {
      let uid: string
      try { uid = await requireUser(req) } catch { return unauthorized() }
      const candidate = await welcomeCandidate(uid)
      if (!candidate) return NextResponse.json({ sent: false, reason: 'not due' })
      const results = await send([candidate], false)
      return NextResponse.json({ sent: results[0]?.ok === true })
    }

    const viaCron = cronAuthorised(req)
    if (!viaCron) {
      try { await requireAdmin(req) } catch { return unauthorized() }
    }

    if (action === 'preview') {
      const candidates = await findCandidates()
      return NextResponse.json({ configured: emailConfigured(), candidates })
    }

    if (action === 'log') {
      return NextResponse.json({ configured: emailConfigured(), log: await recentEmailLog(150) })
    }

    if (action === 'run') {
      if (!emailConfigured() && !body.dryRun) {
        return NextResponse.json({ error: 'Email is not configured. Set ZOHO_SMTP_USER and ZOHO_SMTP_PASS.' }, { status: 503 })
      }
      const candidates = await findCandidates()
      const results = await send(candidates, !!body.dryRun)
      const failed = results.filter(r => !r.ok).length
      logToSink({
        level: failed ? 'warn' : 'info', tag: 'lifecycle-email', route: '/api/lifecycle',
        message: `${body.dryRun ? 'dry run' : 'sent'} ${results.length} (${failed} failed) of ${candidates.length} due`,
      })
      return NextResponse.json({ due: candidates.length, sent: results.length, failed, results })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    logToSink({ level: 'error', tag: 'lifecycle-email', message: msg, route: '/api/lifecycle', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Vercel Cron issues a GET. Same work, same secret.
export async function GET(req: NextRequest) {
  if (!cronAuthorised(req)) return unauthorized()
  const candidates = await findCandidates()
  const results = await send(candidates, false)
  const failed = results.filter(r => !r.ok).length
  logToSink({
    level: failed ? 'warn' : 'info', tag: 'lifecycle-email', route: '/api/lifecycle',
    message: `cron sent ${results.length} (${failed} failed) of ${candidates.length} due`,
  })
  return NextResponse.json({ due: candidates.length, sent: results.length, failed })
}
