import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

// NOTE: do NOT import 'firebase-admin/auth' here. It pulls in jwks-rsa → jose,
// which is ESM-only and crashes with ERR_REQUIRE_ESM at runtime on Vercel's
// Node bundle. Every route that imports this module (generate, transcribe,
// chat, support) would then 500 at import time. Auth token verification lives
// in firebase-admin-auth.ts and is imported only by the admin route.
export function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  })
}

export function adminDb() {
  return getFirestore(getAdminApp())
}

export function adminStorage() {
  return getStorage(getAdminApp())
}
