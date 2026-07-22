import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
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
