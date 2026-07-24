// One-time bootstrap: grant the admin custom claim to a user.
//
//   node scripts/set-admin-claim.mjs <uid>
//
// Uses the same FIREBASE_ADMIN_* env vars as the app (load them into your shell
// first, e.g. via `set -a; source .env.local; set +a`). After running, the user
// must sign out and back in (or refresh their ID token) for the claim to apply.
// To revoke: node scripts/set-admin-claim.mjs <uid> --revoke
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const uid = process.argv[2] || process.env.ADMIN_UID
const revoke = process.argv.includes('--revoke')
if (!uid) {
  console.error('Usage: node scripts/set-admin-claim.mjs <uid> [--revoke]')
  process.exit(1)
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

await getAuth().setCustomUserClaims(uid, revoke ? { admin: false } : { admin: true })
await getAuth().revokeRefreshTokens(uid)
console.log(`✓ admin claim ${revoke ? 'revoked' : 'set'} for ${uid}. The user must re-sign-in for it to take effect.`)
process.exit(0)
