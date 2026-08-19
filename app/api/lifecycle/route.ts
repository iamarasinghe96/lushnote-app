import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireUser, unauthorized } from '@/lib/adminGuard'
import { sendEmail, emailConfigured } from '@/lib/email'
import { renderLifecycleEmail, LIFECYCLE_TYPES, type LifecycleEmailType } from '@/lib/emails/lifecycle'
import { findCandidates, markSent, logEmail, recentEmailLog, unsubscribeUrl, welcomeCandidate, getTemplates, templateFor, saveTemplate, resetTemplate, type Candidate } from '@/lib/firestore/lifecycle'
import { runBillingSweep } from '@/lib/firestore/billingSweep'
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

async function send(candidates: Candidate[]) {
  const results: { uid: string; email: string; type: string; ok: boolean; error?: string }[] = []
  for (const c of candidates.slice(0, MAX_PER_RUN)) {
    const tpl = await templateFor(c.type)
    const mail = renderLifecycleEmail(tpl, {
      displayName: c.displayName,
      unsubscribeUrl: unsubscribeUrl(c.uid),
      trialEnd: c.trialEnd,
    })
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
    const body = await req.json().catch(() => ({})) as {
      action?: string
      type?: string
      subject?: string
      template?: string
    }
    const action = body.action ?? 'log'

    // The welcome must not wait for the nightly run — it opens with "you've just
    // signed in". Any signed-in doctor can trigger it, but only for their own
    // account, and only once.
    if (action === 'welcome') {
      let uid: string
      try { uid = await requireUser(req) } catch { return unauthorized() }
      const candidate = await welcomeCandidate(uid)
      if (!candidate) return NextResponse.json({ sent: false, reason: 'not due' })
      const results = await send([candidate])
      return NextResponse.json({ sent: results[0]?.ok === true })
    }

    let actorUid: string
    try { actorUid = (await requireAdmin(req)).uid } catch { return unauthorized() }

    if (action === 'overview') {
      const [candidates, templates] = await Promise.all([findCandidates(), getTemplates()])
      return NextResponse.json({
        configured: emailConfigured(),
        // Counts only: the console reports what the nightly run will do, it does
        // not drive it.
        due: LIFECYCLE_TYPES.map(t => ({ type: t, n: candidates.filter(c => c.type === t).length })),
        templates,
        log: await recentEmailLog(150),
      })
    }

    const type = LIFECYCLE_TYPES.find(t => t === body.type) as LifecycleEmailType | undefined

    if (action === 'saveTemplate') {
      if (!type || !body.subject?.trim() || !body.template?.trim()) {
        return NextResponse.json({ error: 'A subject and a body are both required.' }, { status: 400 })
      }
      await saveTemplate(type, { subject: body.subject.trim(), body: body.template }, actorUid)
      logToSink({ level: 'info', tag: 'lifecycle-email', route: '/api/lifecycle', uid: actorUid, message: `template edited: ${type}` })
      return NextResponse.json({ templates: await getTemplates() })
    }

    if (action === 'resetTemplate') {
      if (!type) return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
      await resetTemplate(type)
      logToSink({ level: 'info', tag: 'lifecycle-email', route: '/api/lifecycle', uid: actorUid, message: `template reset: ${type}` })
      return NextResponse.json({ templates: await getTemplates() })
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
  // Billing state first, so a doctor paywalled tonight gets tonight's email
  // about the state they are actually in rather than yesterday's. A failure
  // here must not cost anyone their reminder, so it never throws outward.
  const sweep = await runBillingSweep().catch(err => {
    logToSink({
      level: 'warn', tag: 'billing', route: '/api/lifecycle',
      message: `sweep failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
    })
    return null
  })
  const candidates = await findCandidates()
  const results = await send(candidates)
  const failed = results.filter(r => !r.ok).length
  logToSink({
    level: failed ? 'warn' : 'info', tag: 'lifecycle-email', route: '/api/lifecycle',
    message: `cron sent ${results.length} (${failed} failed) of ${candidates.length} due`,
  })
  return NextResponse.json({ due: candidates.length, sent: results.length, failed, sweep })
}
