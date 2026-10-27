// Local mode: the whole app on this computer, against Firebase's emulators.
//
//   npm run dev:local                 start (made-up data is kept between runs)
//   npm run dev:local -- --reset      start again from fresh made-up data
//   npm run dev:local -- --real-ai    use the AI keys in .env.local instead of
//                                     canned replies
//   npm run dev:local -- --prod       build and serve the production build
//                                     instead of the dev server (what CI's
//                                     browser suite runs against)
//
// Then open http://localhost:3000/e2e-login and sign in as
// admin@lushnote.local / local-admin. LOCAL_DEVELOPMENT.md has the rest.
//
// Nothing here can touch a real Firebase project: the project id is a `demo-`
// one, which the emulators never connect to the cloud, and every Firebase
// variable is overridden below whatever .env.local says. Keys that would act on
// the real world from a laptop (merging to main, live Stripe, Slack, email) are
// blanked for the same reason.
//
// Plain Node with no shell, so it runs the same in PowerShell, cmd and bash.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = join(ROOT, '.local-data')
const args = process.argv.slice(2)
const RESET = args.includes('--reset')
const REAL_AI = args.includes('--real-ai')
const PROD = args.includes('--prod')

// Mirrors lib/localEmulators.ts, which a plain .mjs script cannot import.
const PROJECT_ID = 'demo-lushnote'
const PORTS = { auth: 9099, firestore: 8080, storage: 9199 }
const ADMIN = { uid: 'local-admin', email: 'admin@lushnote.local', password: 'local-admin' }
// The address the browser suite's fixture account has always used
// (lib/e2eMock.ts), so `npm run test:e2e` can run against local mode too.
const E2E = { uid: 'local-e2e', email: 'e2e-tester@lushnote.com.au', password: 'local-e2e-password' }

function say(msg) { process.stdout.write(`\n[local] ${msg}\n`) }
function fail(msg) { process.stderr.write(`\n[local] ${msg}\n\n`); process.exit(1) }

// ── Java: the Firestore and Storage emulators are Java programs ──────────────
const java = spawnSync('java', ['-version'], { encoding: 'utf8' })
if (java.error) {
  fail('Java is not installed. Install the free "Temurin 21 (LTS)" from https://adoptium.net, open a NEW terminal, and run this again.')
}
const javaMajor = Number(/version "(\d+)/.exec(`${java.stderr}${java.stdout}`)?.[1] ?? 0)
if (javaMajor && javaMajor < 21) {
  fail(`Java ${javaMajor} is installed, but the Firebase emulators need Java 21 or newer. Install "Temurin 21 (LTS)" from https://adoptium.net, open a NEW terminal, and run this again.`)
}

// ── The environment every child process gets ─────────────────────────────────
// Load .env.local the way Next will, so the blanking below can see real values.
require('@next/env').loadEnvConfig(ROOT, true, { info() {}, error() {} })
const live = v => /^(sk|pk|rk)_live_/.test(v ?? '')

const env = {
  ...process.env,
  NEXT_PUBLIC_USE_EMULATORS: '1',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '0',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:0:web:local',
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PORTS.firestore}`,
  FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PORTS.auth}`,
  FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${PORTS.storage}`,
  FIREBASE_ADMIN_PROJECT_ID: '',
  FIREBASE_ADMIN_CLIENT_EMAIL: '',
  FIREBASE_ADMIN_PRIVATE_KEY: '',
  NEXT_PUBLIC_ADMIN_UID: ADMIN.uid,
  ADMIN_UID: ADMIN.uid,
  // The email-and-password sign-in page. Google sign-in works too, through
  // the emulator's own pretend account picker.
  NEXT_PUBLIC_E2E: '1',
  E2E_MOCK_AI: REAL_AI ? '' : '1',
  // A real token here would let Promote on a laptop merge to main for real.
  GITHUB_TOKEN: '',
  VERCEL_AUTOMATION_BYPASS_SECRET: '',
  NEXT_PUBLIC_STAGING_URL: '',
  SLACK_WEBHOOK: '',
  SLACK_BOT_TOKEN: '',
  ZOHO_SMTP_HOST: '',
  ZOHO_SMTP_USER: '',
  ZOHO_SMTP_PASS: '',
  // Stripe test keys are fine and make billing work locally; live ones are not.
  STRIPE_SECRET_KEY: live(process.env.STRIPE_SECRET_KEY) ? '' : (process.env.STRIPE_SECRET_KEY ?? ''),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: live(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) ? '' : (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''),
  STRIPE_WEBHOOK_SECRET: '',
}
Object.assign(process.env, env)

// ── Start the emulators ──────────────────────────────────────────────────────
if (RESET && existsSync(DATA_DIR)) {
  rmSync(DATA_DIR, { recursive: true, force: true })
  say('Cleared the saved local data. Starting fresh.')
}

const firebaseBin = join(dirname(require.resolve('firebase-tools/package.json')), 'lib', 'bin', 'firebase.js')
const emuArgs = [
  firebaseBin, 'emulators:start',
  '--only', 'auth,firestore,storage',
  '--project', PROJECT_ID,
  '--export-on-exit', DATA_DIR,
  ...(existsSync(DATA_DIR) ? ['--import', DATA_DIR] : []),
]
say('Starting the Firebase emulators (the first run downloads them, about a minute)...')
const emulators = spawn(process.execPath, emuArgs, { cwd: ROOT, env, stdio: 'inherit' })
let nextDev = null
let stopping = false

emulators.on('exit', code => {
  if (!stopping && !nextDev) fail(`The emulators stopped before they were ready (exit ${code}). The messages above say why.`)
  if (nextDev && nextDev.exitCode === null) nextDev.kill('SIGINT')
  process.exit(code ?? 0)
})

// Ctrl+C reaches the children from the terminal on its own. Waiting for the
// emulators to exit is what gives them time to save the data for next time.
process.on('SIGINT', () => { stopping = true; say('Stopping, and saving the local data for next time...') })

function portOpen(port) {
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1')
    s.once('connect', () => { s.end(); resolve(true) })
    s.once('error', () => resolve(false))
  })
}

async function waitForPorts(timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const open = await Promise.all(Object.values(PORTS).map(portOpen))
    if (open.every(Boolean)) return true
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

if (!(await waitForPorts(180_000))) {
  stopping = true
  emulators.kill('SIGINT')
  fail('The emulators did not start within 3 minutes. If another LushNote local session is open, close it first.')
}

// ── Made-up data, once ───────────────────────────────────────────────────────
await (await import('./seed-local.mjs')).seed({ projectId: PROJECT_ID, admin: ADMIN, e2e: E2E })

// ── The app ──────────────────────────────────────────────────────────────────
const nextBin = join(dirname(require.resolve('next/package.json')), 'dist', 'bin', 'next')
if (PROD) {
  say('Building the app the way production does...')
  const built = spawnSync(process.execPath, [nextBin, 'build'], { cwd: ROOT, env, stdio: 'inherit' })
  if (built.status !== 0) {
    stopping = true
    emulators.kill('SIGINT')
    fail('The build failed. The messages above say why.')
  }
}
nextDev = spawn(process.execPath, [nextBin, PROD ? 'start' : 'dev'], { cwd: ROOT, env, stdio: 'inherit' })
nextDev.on('exit', () => {
  if (emulators.exitCode === null) { stopping = true; emulators.kill('SIGINT') }
})

say([
  'Local mode is starting at http://localhost:3000',
  `  Sign in at http://localhost:3000/e2e-login as ${ADMIN.email} / ${ADMIN.password}`,
  `  AI: ${REAL_AI ? 'real, using the keys in .env.local' : 'canned replies (add --real-ai to use your own keys)'}`,
  '  Everything is made up and stays on this computer. Ctrl+C to stop.',
].join('\n'))
