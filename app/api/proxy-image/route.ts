import { NextRequest, NextResponse } from 'next/server'

// Same-origin proxy for letterhead/signature images so they can be drawn onto a
// canvas (for PDF export) without cross-origin canvas tainting. Restricted to the
// project's storage hosts to avoid being an open proxy (SSRF).
const ALLOWED_HOSTS = new Set([
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
])

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url')
  if (!target) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 })
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
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
    },
  })
}
