import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'
import { HOLIDAY_KEYS, type HolidayKey } from '@/lib/holidayTheme'

const MAX_BYTES = 200 * 1024
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'upload' | 'reset' | 'scrim' | 'campaign' | 'campaignClear'
      key?: string; dataUrl?: string; scrimOpacity?: number
      campaign?: { label?: string; start?: string; end?: string; banner?: string }
    }
    const { action, key } = body

    try { await requireAdmin(req) } catch { return unauthorized() }

    const db = adminDb()
    const ref = db.collection('appearance').doc('holidayTiles')

    if (action === 'campaignClear') {
      await ref.set({ campaign: FieldValue.delete() }, { merge: true })
      return NextResponse.json({ success: true })
    }

    if (action === 'campaign') {
      const c = body.campaign ?? {}
      const label = c.label?.trim() ?? ''
      const start = c.start ?? ''
      const end = c.end ?? ''
      if (!label) return NextResponse.json({ error: 'Give the campaign a name' }, { status: 400 })
      if (!ISO_DATE.test(start) || !ISO_DATE.test(end))
        return NextResponse.json({ error: 'Both dates are required' }, { status: 400 })
      if (end < start) return NextResponse.json({ error: 'The end date is before the start date' }, { status: 400 })
      await ref.set({
        campaign: { label: label.slice(0, 60), start, end, banner: (c.banner?.trim() ?? '').slice(0, 80) },
      }, { merge: true })
      return NextResponse.json({ success: true })
    }

    if (!key || !(HOLIDAY_KEYS as string[]).includes(key))
      return NextResponse.json({ error: 'Unknown theme' }, { status: 400 })
    const themeKey = key as HolidayKey

    const bucket = adminStorage().bucket()
    const path = `holidayTiles/${themeKey}.webp`

    if (action === 'reset') {
      await bucket.file(path).delete().catch(() => {})
      const tiles = { ...((await ref.get()).data()?.tiles ?? {}) } as Record<string, string>
      delete tiles[themeKey]
      await ref.set({ tiles }, { merge: false })
      return NextResponse.json({ success: true, tiles })
    }

    if (action === 'scrim') {
      const v = body.scrimOpacity
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1)
        return NextResponse.json({ error: 'Text highlight must be between 0 and 1' }, { status: 400 })
      await ref.set({ scrims: { [themeKey]: v } }, { merge: true })
      return NextResponse.json({ success: true })
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
