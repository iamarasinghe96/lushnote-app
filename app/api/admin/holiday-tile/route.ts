import { NextRequest, NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'
import { HOLIDAY_KEYS, type HolidayKey } from '@/lib/holidayTheme'

const MAX_BYTES = 200 * 1024

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { action: 'upload' | 'reset'; key?: string; dataUrl?: string }
    const { action, key } = body

    try { await requireAdmin(req) } catch { return unauthorized() }

    if (!key || !(HOLIDAY_KEYS as string[]).includes(key))
      return NextResponse.json({ error: 'Unknown theme' }, { status: 400 })
    const themeKey = key as HolidayKey

    const db = adminDb()
    const bucket = adminStorage().bucket()
    const ref = db.collection('appearance').doc('holidayTiles')
    const path = `holidayTiles/${themeKey}.webp`

    if (action === 'reset') {
      await bucket.file(path).delete().catch(() => {})
      const tiles = { ...((await ref.get()).data()?.tiles ?? {}) } as Record<string, string>
      delete tiles[themeKey]
      await ref.set({ tiles }, { merge: false })
      return NextResponse.json({ success: true, tiles })
    }

    if (action === 'upload') {
      const { dataUrl } = body
      if (!dataUrl?.startsWith('data:image/webp;base64,'))
        return NextResponse.json({ error: 'Expected a WebP tile' }, { status: 400 })
      const buffer = Buffer.from(dataUrl.slice('data:image/webp;base64,'.length), 'base64')
      if (buffer.length > MAX_BYTES)
        return NextResponse.json({ error: 'Tile is too large' }, { status: 400 })

      const file = bucket.file(path)
      await file.save(buffer, { metadata: { contentType: 'image/webp', cacheControl: 'public, max-age=300' } })
      await file.makePublic()
      // The version query defeats the CDN cache, so a re-upload is visible at
      // once instead of after the cache expires.
      const url = `https://storage.googleapis.com/${bucket.name}/${path}?v=${Date.now()}`
      await ref.set({ tiles: { [themeKey]: url } }, { merge: true })
      return NextResponse.json({ success: true, url })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    logToSink({ level: 'error', tag: 'admin/holiday-tile', message: msg, route: '/api/admin/holiday-tile', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
