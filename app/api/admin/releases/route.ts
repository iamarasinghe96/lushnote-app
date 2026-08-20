import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { adminDb } from '@/lib/firebase-admin'
import { adminAuth } from '@/lib/firebase-admin-auth'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink, writeAudit } from '@/lib/firestore/systemLogs'
import {
  githubConfigured, listOpenPulls, getPull, mainHeadSha, promotePull,
  deleteBranch, rerunCheck, liveVersion,
} from '@/lib/github'

// The release surface. Everything a promotion needs to be a considered decision
// — what is running, what is proposed, whether it was tested — without opening
// GitHub, Vercel or a database console.

export const runtime = 'nodejs'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lushnote.com.au'
const E2E_EMAIL = 'e2e-tester@lushnote.com.au'

/**
 * The fixture account the browser suite signs in as.
 *
 * Deliberately NOT an admin: these credentials live in GitHub Actions secrets,
 * and a leaked test password must not reach the admin console or the token
 * behind these very actions. Marked billingExempt so it never enters the
 * nightly sweep, never receives a lifecycle email, and never hits a paywall
 * that would fail the suite for a reason unrelated to the change under test.
 */
async function provisionE2eUser(): Promise<{ email: string; password: string; uid: string; created: boolean }> {
  const password = `E2e-${randomBytes(18).toString('base64url')}`
  let uid: string
  let created = false

  try {
    const existing = await adminAuth().getUserByEmail(E2E_EMAIL)
    uid = existing.uid
    // Rotating the password on every provision is the point: the button exists
    // to hand the admin a value they can paste into GitHub, and one they cannot
    // read back is no use.
    await adminAuth().updateUser(uid, { password, disabled: false })
  } catch {
    const user = await adminAuth().createUser({
      email: E2E_EMAIL, password, displayName: 'E2E Tester', emailVerified: true,
    })
    uid = user.uid
    created = true
  }

  // A COMPLETE profile, so sign-in lands in the app shell rather than in
  // onboarding, which the suite has no reason to drive.
  await adminDb().collection('users').doc(uid).set({
    displayName: 'E2E Tester',
    credentials: 'Automated test account',
    email: E2E_EMAIL,
    status: 'active',
    tier: 'free',
    onboardingComplete: true,
    marketingConsent: false,
    emailOptOut: true,
    activeWorkplaceId: 'e2e-clinic',
    workplaces: [{
      id: 'e2e-clinic', name: 'E2E Test Clinic', type: 'Private Practice',
      regSystem: 'none', themeIndex: 2,
    }],
    billing: { billingExempt: true, updatedAt: Date.now() },
    updatedAt: Date.now(),
  }, { merge: true })

  return { email: E2E_EMAIL, password, uid, created }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'overview' | 'promote' | 'rerun' | 'provisionE2eUser'
      number?: number
      headSha?: string
      title?: string
      runId?: number
      override?: boolean
      reason?: string
    }

    let actor
    try { actor = await requireAdmin(req) } catch { return unauthorized() }

    if (body.action === 'provisionE2eUser') {
      const result = await provisionE2eUser()
      // The password is returned once and never stored anywhere readable. It
      // is deliberately absent from the audit entry.
      await writeAudit({ actorUid: actor.uid, action: 'release.provisionE2eUser', targetUid: result.uid, meta: { created: result.created } })
      return NextResponse.json(result)
    }

    if (!githubConfigured()) {
      return NextResponse.json({
        configured: false,
        error: 'GITHUB_TOKEN and GITHUB_REPO are not set on this deployment.',
      })
    }

    if (body.action === 'overview') {
      const [head, live, pulls] = await Promise.all([
        mainHeadSha(),
        liveVersion(SITE_URL),
        listOpenPulls(),
      ])
      return NextResponse.json({
        configured: true,
        site: SITE_URL,
        mainSha: head,
        liveSha: live?.sha ?? null,
        liveBuiltAt: live?.builtAt ?? null,
        // Compared here rather than in the browser so both readings come from
        // the same request and cannot disagree by a few seconds.
        deploying: !!live && live.sha !== 'dev' && live.sha !== head,
        pulls,
      })
    }

    if (body.action === 'rerun') {
      if (!body.runId) return NextResponse.json({ error: 'runId required' }, { status: 400 })
      await rerunCheck(body.runId)
      await writeAudit({ actorUid: actor.uid, action: 'release.rerun', meta: { runId: body.runId } })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'promote') {
      const number = body.number
      if (!number) return NextResponse.json({ error: 'number required' }, { status: 400 })

      const pull = await getPull(number)
      if (!pull) return NextResponse.json({ error: 'Pull request not found or already merged' }, { status: 404 })

      // The head sha the admin was looking at must still be the head sha now.
      // Two pushes in quick succession would otherwise promote a commit whose
      // checks nobody read.
      if (body.headSha && body.headSha !== pull.headSha) {
        return NextResponse.json({ error: 'The branch has moved since this page loaded. Reload and check again.' }, { status: 409 })
      }

      if (pull.blockedReason && !body.override) {
        return NextResponse.json({ error: pull.blockedReason, blocked: true }, { status: 409 })
      }

      const merged = await promotePull(number, pull.headSha, pull.title)
      await deleteBranch(pull.branch)

      // An override is a deliberate decision to ship something the gate refused.
      // It is recorded with the reason given, at error level so it reaches Slack
      // — not to accuse anyone, but so a later "how did that get out" has an
      // answer.
      await writeAudit({
        actorUid: actor.uid, action: 'release.promote',
        meta: { number, headSha: pull.headSha, mergeSha: merged.sha, override: !!body.override, reason: body.reason ?? '', blockedReason: pull.blockedReason },
      })
      logToSink({
        level: body.override ? 'error' : 'info', tag: 'release', route: '/api/admin/releases',
        message: body.override
          ? `PR #${number} promoted despite: ${pull.blockedReason || 'no recorded reason'}`
          : `PR #${number} promoted`,
      })

      return NextResponse.json({ success: true, mergeSha: merged.sha })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    logToSink({ level: 'error', tag: 'admin/releases', route: '/api/admin/releases', message: msg.slice(0, 300), status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
