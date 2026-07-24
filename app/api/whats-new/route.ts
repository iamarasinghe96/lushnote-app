import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

function millis(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null
}

// Public read of PUBLISHED release notes only (drafts never leave the server, since
// the announcements collection is denied to clients by the catch-all rule and is
// served exclusively through this filtered endpoint). Used by the one-time popup
// and the Settings "What's New" tab.
export async function GET() {
  try {
    const snap = await adminDb().collection('announcements').where('published', '==', true).limit(50).get()
    const items = snap.docs
      .map(d => {
        const x = d.data()
        return { id: d.id, title: x.title ?? '', summary: x.summary ?? '', details: x.details ?? '', version: x.version ?? '', publishedAt: millis(x.publishedAt) ?? millis(x.createdAt) }
      })
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    return NextResponse.json({ announcements: items })
  } catch {
    // Never break the app if this fails — the popup/tab just show nothing.
    return NextResponse.json({ announcements: [] })
  }
}
