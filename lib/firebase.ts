import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// On our production host, use that host itself as the auth domain so Firebase's
// sign-in handler is served same-origin (via the __/auth rewrites in
// next.config). Cross-origin (firebaseapp.com) partitioned storage was causing
// the intermittent "missing initial state" sign-in error in Safari / in-app
// browsers. Anywhere else (localhost, Vercel previews — which aren't authorised
// Firebase domains) we keep the default firebaseapp.com auth domain.
function resolveAuthDomain(): string | undefined {
  const envDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'lushnote.com.au' || host === 'www.lushnote.com.au') return host
  }
  return envDomain
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
const auth = getAuth(app)

// ignoreUndefinedProperties drops `undefined` fields instead of throwing
// `invalid-argument` on the whole write. Optional fields left undefined (e.g.
// a segment log entry's `error`/`provider` on a successful transcription) were
// rejecting the entire recovery-draft save, silently disabling recording
// recovery. initializeFirestore must run once before any getFirestore call;
// fall back to getFirestore if the instance already exists (HMR / re-import).
let db: Firestore
try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true })
} catch {
  db = getFirestore(app)
}
const storage = getStorage(app)

export { app, auth, db, storage }
