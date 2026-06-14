import { NextRequest, NextResponse } from 'next/server'
import { adminDb, adminStorage } from '@/lib/firebase-admin'
import { toOrganizationKey } from '@/lib/utils'

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      uid: string
      action: 'listRequests' | 'listLetterheads' | 'upload' | 'markDone'
      requestId?: string
      organizationKey?: string
      organizationName?: string
      headerDataUrl?: string | null
      footerDataUrl?: string | null
    }

    const { uid, action } = body

    if (!uid || uid !== ADMIN_UID) return unauthorized()

    const db = adminDb()

    if (action === 'listRequests') {
      const snap = await db.collection('letterheadRequests').orderBy('createdAt', 'desc').limit(100).get()
      const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      return NextResponse.json({ requests })
    }

    if (action === 'listLetterheads') {
      const snap = await db.collection('letterheads').get()
      const letterheads = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      return NextResponse.json({ letterheads })
    }

    if (action === 'upload') {
      const { organizationName, headerDataUrl, footerDataUrl } = body
      if (!organizationName) return NextResponse.json({ error: 'organizationName required' }, { status: 400 })

      const key = toOrganizationKey(organizationName)
      const bucket = adminStorage().bucket()
      const urls: { headerUrl: string | null; footerUrl: string | null } = {
        headerUrl: null,
        footerUrl: null,
      }

      const uploadImage = async (dataUrl: string, slot: 'header' | 'footer'): Promise<string> => {
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64, 'base64')
        const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/)
        const contentType = mimeMatch ? mimeMatch[1] : 'image/png'
        const ext = contentType.split('/')[1] ?? 'png'
        const path = `letterheads/${key}/${slot}.${ext}`
        const file = bucket.file(path)
        await file.save(buffer, { metadata: { contentType } })
        await file.makePublic()
        return `https://storage.googleapis.com/${bucket.name}/${path}`
      }

      if (headerDataUrl) urls.headerUrl = await uploadImage(headerDataUrl, 'header')
      if (footerDataUrl) urls.footerUrl = await uploadImage(footerDataUrl, 'footer')

      await db.collection('letterheads').doc(key).set({
        organizationKey: key,
        organizationName,
        headerUrl: urls.headerUrl,
        footerUrl: urls.footerUrl,
      }, { merge: true })

      return NextResponse.json({ success: true, key, ...urls })
    }

    if (action === 'markDone') {
      const { requestId } = body
      if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })
      await db.collection('letterheadRequests').doc(requestId).update({ status: 'done' })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
