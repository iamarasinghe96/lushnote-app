import { getAuth } from 'firebase-admin/auth'
import { getAdminApp } from '@/lib/firebase-admin'

// Isolated here because 'firebase-admin/auth' transitively requires jose (an
// ESM-only package) via jwks-rsa, which crashes with ERR_REQUIRE_ESM at import
// time on Vercel's Node runtime. Only the admin route needs token verification,
// so only it imports this module — keeping the crash out of every other route.
export function adminAuth() {
  return getAuth(getAdminApp())
}
