import { NextRequest, NextResponse } from 'next/server'
import { unsubscribeValid, setEmailOptOut } from '@/lib/firestore/lifecycle'
import { logToSink } from '@/lib/firestore/systemLogs'

// One-click opt-out from the link in every lifecycle email. No sign-in: a doctor
// who wants out should not have to log in to get out. The signed token is scoped
// to their own uid, so it cannot unsubscribe anyone else.
export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get('u') ?? ''
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!uid || !unsubscribeValid(uid, token)) {
    return NextResponse.json({ error: 'This unsubscribe link is not valid.' }, { status: 400 })
  }
  try {
    await setEmailOptOut(uid, true)
    logToSink({ level: 'info', tag: 'lifecycle-email', message: 'unsubscribed', route: '/api/unsubscribe', uid })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Could not update your preference. Please email admin@lushnote.com.au.' }, { status: 500 })
  }
}
