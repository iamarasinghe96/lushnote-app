import { NextRequest, NextResponse } from 'next/server'

// Same-origin proxy for letterhead/signature images so they can be drawn onto a
// canvas (for PDF export) without cross-origin canvas tainting.
//
// Only this project's own bucket. The old check allowed the two Google Storage
// HOSTS, which is every bucket in the world, so anyone could serve their own
// file from lushnote.com.au. With an SVG that is a page: opened directly, its
// scripts ran on this origin, next to the doctor's Firebase session.
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ''
const BUCKETS = new Set(
  [
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    // A project's default bucket is one of these two, depending on when it was
    // created; accepting both keeps older saved URLs working.
    PROJECT_ID && `${PROJECT_ID}.appspot.com`,
    PROJECT_ID && `${PROJECT_ID}.firebasestorage.app`,
  ].filter((b): b is string => !!b),
)

function isOurStorage(u: URL): boolean {
  if (u.protocol !== 'https:') return false
  // firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>  (getDownloadURL)
  if (u.hostname === 'firebasestorage.googleapis.com') {
    const m = /^\/v0\/b\/([^/]+)\/o\//.exec(u.pathname)
    return !!m && BUCKETS.has(m[1])
  }
  // storage.googleapis.com/<bucket>/<path>  (the admin uploads' public URLs)
  if (u.hostname === 'storage.googleapis.com') {
    const bucket = u.pathname.split('/')[1]
    return !!bucket && BUCKETS.has(bucket)
  }
  return false
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }

  if (!isOurStorage(parsed)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 403 })
  }

  let upstream: Response
  try {
    upstream = await fetch(parsed.toString())
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 })
  }

  const contentType = upstream.headers.get('content-type') || 'image/png'
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'not an image' }, { status: 415 })
  }

  const buffer = await upstream.arrayBuffer()
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      // Our own bucket still holds files a doctor chose, including their
      // signature SVG. An <img> or a fetch ignores these; a browser opening the
      // URL directly downloads the file instead of running it as a page.
      'Content-Disposition': 'attachment',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    },
  })
}
