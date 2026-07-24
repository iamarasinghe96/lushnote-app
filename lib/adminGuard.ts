import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin-auth'
import type { DecodedIdToken } from 'firebase-admin/auth'

// Bootstrap seed: the very first admin, before any custom claim is set. Once the
// `admin:true` claim exists (scripts/set-admin-claim.mjs), the claim is the source
// of truth and this env is only a fallback so you can never lock yourself out.
const ADMIN_UID = process.env.ADMIN_UID ?? process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

// Thrown by requireAdmin; callers map it to a 401. Never leak the reason to the client.
export class AdminAuthError extends Error {}

// The single admin authorization gate. Verify a real Google-signed ID token AND
// that the caller is an admin — by the `admin:true` custom claim (preferred,
// instantly revocable) or the bootstrap ADMIN_UID. `checkRevoked: true` lets a
// compromised session be killed by revoking the user's refresh tokens. NEVER
// trust a client-supplied uid — only the decoded token.
export async function requireAdmin(req: NextRequest): Promise<DecodedIdToken> {
  const authHeader = req.headers.get('authorization') || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!idToken) throw new AdminAuthError('missing token')

  let decoded: DecodedIdToken
  try {
    decoded = await adminAuth().verifyIdToken(idToken, true)
  } catch {
    throw new AdminAuthError('invalid token')
  }

  const isAdmin = decoded.admin === true || (!!ADMIN_UID && decoded.uid === ADMIN_UID)
  if (!isAdmin) throw new AdminAuthError('not an admin')
  return decoded
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
