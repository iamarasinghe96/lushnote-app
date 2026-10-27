import { initializeApp, getApps } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { initializeFirestore, getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { clientUsesEmulators, EMULATOR_PORTS } from '@/lib/localEmulators'

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

// Local mode (npm run dev:local). Connected once per page: a hot reload
// re-runs this module against the same already-started instances, and
// connecting a started Firestore throws.
const g = globalThis as { __lushnoteEmulators?: boolean }
if (typeof window !== 'undefined' && !g.__lushnoteEmulators
    && clientUsesEmulators(process.env.NEXT_PUBLIC_USE_EMULATORS, window.location.hostname)) {
  const host = window.location.hostname
  connectAuthEmulator(auth, `http://${host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, EMULATOR_PORTS.firestore)
  connectStorageEmulator(storage, host, EMULATOR_PORTS.storage)
  g.__lushnoteEmulators = true
}

export { app, auth, db, storage }
