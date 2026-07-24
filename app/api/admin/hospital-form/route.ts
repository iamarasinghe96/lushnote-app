import { NextRequest, NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { requireAdmin, unauthorized } from '@/lib/adminGuard'
import { logToSink } from '@/lib/firestore/systemLogs'
import { toOrganizationKey } from '@/lib/utils'
import type { HospitalFormDoc, HospitalFormGeometry } from '@/types'

// Validate the geometry blob the admin supplies (mm numbers). Rejects anything
// missing or non-numeric so a bad paste can't render a broken form.
function validGeometry(g: unknown): g is HospitalFormGeometry {
  if (!g || typeof g !== 'object') return false
  const o = g as Record<string, unknown>
  const num = (v: unknown) => typeof v === 'number' && isFinite(v) && v >= 0
  const pid = o.pid as Record<string, unknown> | undefined
  return num(o.tableTopMm) && num(o.tableLeftMm) && num(o.dateColMm) && num(o.notesColMm)
    && num(o.rowHeightMm) && num(o.rowsPerPage) && (o.rowsPerPage as number) > 0 && num(o.fontPt)
    && !!pid && num(pid.topMm) && num(pid.leftMm) && num(pid.widthMm) && num(pid.rowHeightMm)
    && num(pid.dobSexGapMm) && num(pid.sexWidthMm)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'listForms' | 'upload' | 'deleteForm'
      formKey?: string
      name?: string
      organizationNames?: string[]
      geometry?: unknown
      labels?: { dateCol?: string; notesCol?: string }
      pageDataUrls?: (string | null)[]   // one per page; null = keep existing
    }
    const { action } = body

    try { await requireAdmin(req) } catch { return unauthorized() }

    const db = adminDb()
    const bucket = adminStorage().bucket()

    if (action === 'listForms') {
      const snap = await db.collection('hospitalForms').get()
      return NextResponse.json({ forms: snap.docs.map(d => d.data()) })
    }

    if (action === 'deleteForm') {
      const { formKey } = body
      if (!formKey) return NextResponse.json({ error: 'formKey required' }, { status: 400 })
      await bucket.deleteFiles({ prefix: `hospitalForms/${formKey}/` }).catch(() => {})
      await db.collection('hospitalForms').doc(formKey).delete()
      return NextResponse.json({ success: true })
    }

    if (action === 'upload') {
      const { name, organizationNames, geometry, labels, pageDataUrls } = body
      if (!name || !name.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
      if (!Array.isArray(organizationNames) || organizationNames.length === 0)
        return NextResponse.json({ error: 'At least one campus is required' }, { status: 400 })
      if (!validGeometry(geometry)) return NextResponse.json({ error: 'Invalid geometry' }, { status: 400 })

      const formKey = toOrganizationKey(name)
      const organizationKeys = Array.from(new Set(organizationNames.map(n => toOrganizationKey(n)).filter(Boolean)))

      // Merge page backgrounds with any existing doc so geometry-only edits don't
      // require re-uploading the images.
      const existing = (await db.collection('hospitalForms').doc(formKey).get()).data() as HospitalFormDoc | undefined
      const existingBg = existing?.pageBackgrounds ?? []
      const slots = pageDataUrls ?? []
      const pageCount = Math.max(slots.length, existingBg.length)

      const uploadImage = async (dataUrl: string, idx: number): Promise<string> => {
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64, 'base64')
        const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/)
        const contentType = mimeMatch ? mimeMatch[1] : 'image/png'
        const ext = contentType.split('/')[1] ?? 'png'
        const path = `hospitalForms/${formKey}/page${idx + 1}.${ext}`
        const file = bucket.file(path)
        await file.save(buffer, { metadata: { contentType } })
        await file.makePublic()
        return `https://storage.googleapis.com/${bucket.name}/${path}`
      }

      const pageBackgrounds: string[] = []
      for (let i = 0; i < pageCount; i++) {
        const provided = slots[i]
        if (provided) pageBackgrounds.push(await uploadImage(provided, i))
        else if (existingBg[i]) pageBackgrounds.push(existingBg[i])
      }
      if (pageBackgrounds.length === 0) return NextResponse.json({ error: 'At least one page image is required' }, { status: 400 })

      const doc: HospitalFormDoc = {
        formKey,
        name: name.trim(),
        organizationKeys,
        pageBackgrounds,
        geometry: geometry as HospitalFormGeometry,
        labels: {
          dateCol: labels?.dateCol?.trim() || 'Date / Time',
          notesCol: labels?.notesCol?.trim() || 'Please sign each entry and print surname and designation',
        },
      }
      await db.collection('hospitalForms').doc(formKey).set(doc)
      return NextResponse.json({ success: true, form: doc })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    console.error('[admin/hospital-form]', msg)
    logToSink({ level: 'error', tag: 'admin/hospital-form', message: msg, route: '/api/admin/hospital-form', status: 500 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
