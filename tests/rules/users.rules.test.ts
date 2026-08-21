import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

// The security rules are the only thing standing between a doctor's clinical
// record and everyone else, and they are the one part of this codebase that
// cannot be typechecked. They also cannot be exercised by the browser suite:
// the fixture account is already onboarded, so the path that broke signup —
// stub, then completed profile — is never walked there.
//
// These run against the real Firestore emulator, so what passes here is what
// Firestore will do.

const UID = 'doctor-1'
const OTHER = 'doctor-2'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'lush-note-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => { await env?.cleanup() })
beforeEach(async () => { await env.clearFirestore() })

const db = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore()

/** The stub AuthProvider writes at first authentication. Deliberately carries
 *  no tier and no status — which is precisely what broke the update below. */
async function seedStub(uid = UID) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      uid, email: 'doctor@example.com', displayName: 'Dr Test', onboardingComplete: false,
    })
  })
}

const COMPLETED_PROFILE = {
  displayName: 'Dr Test', credentials: 'FRANZCP', email: 'doctor@example.com',
  onboardingComplete: true, status: 'active', tier: 'free',
  workplaces: [{ id: 'w1', name: 'Clinic', type: 'Private Practice', regSystem: 'none', themeIndex: 1 }],
  activeWorkplaceId: 'w1', emailPretext: 'Please find enclosed.',
  termsAccepted: true, marketingConsent: false,
}

describe('users/{uid} — finishing onboarding', () => {
  it('lets a doctor complete onboarding over their own stub', async () => {
    // THE REGRESSION. Every new signup does exactly this and every one was
    // denied: the stub has no `tier`, so comparing 'free' against a missing
    // field was false and the whole rule failed at "Get started".
    await seedStub()
    await assertSucceeds(setDoc(doc(db(UID), 'users', UID), COMPLETED_PROFILE, { merge: true }))
  })

  it('lets a brand-new profile be created directly', async () => {
    // The path taken before the stub existed. Must keep working.
    await assertSucceeds(setDoc(doc(db(UID), 'users', UID), COMPLETED_PROFILE))
  })

  it('refuses a signup that tries to start on a paid tier', async () => {
    await seedStub()
    await assertFails(setDoc(doc(db(UID), 'users', UID), { ...COMPLETED_PROFILE, tier: 'pro' }, { merge: true }))
  })

  it('refuses a signup that tries to start already disabled or otherwise odd', async () => {
    await seedStub()
    await assertFails(setDoc(doc(db(UID), 'users', UID), { ...COMPLETED_PROFILE, status: 'disabled' }, { merge: true }))
  })
})

describe('users/{uid} — privilege escalation', () => {
  async function seedComplete(uid = UID, extra: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', uid), { ...COMPLETED_PROFILE, ...extra })
    })
  }

  it('refuses upgrading an existing tier', async () => {
    await seedComplete()
    await assertFails(updateDoc(doc(db(UID), 'users', UID), { tier: 'pro' }))
  })

  it('refuses changing an existing status', async () => {
    // A suspended doctor must not be able to reactivate themselves.
    await seedComplete(UID, { status: 'disabled' })
    await assertFails(updateDoc(doc(db(UID), 'users', UID), { status: 'active' }))
  })

  it('allows an ordinary profile edit that leaves tier and status alone', async () => {
    await seedComplete()
    await assertSucceeds(updateDoc(doc(db(UID), 'users', UID), { credentials: 'MBBS' }))
  })
})

describe('users/{uid} — billing is server-written only', () => {
  it('refuses a client granting itself a subscription', async () => {
    await seedStub()
    await assertFails(setDoc(doc(db(UID), 'users', UID), {
      ...COMPLETED_PROFILE, billing: { subscriptionStatus: 'active', billingExempt: true },
    }, { merge: true }))
  })

  it('refuses an overwrite that drops an existing billing map', async () => {
    // A field is also changed by being REMOVED — a wholesale setDoc that omits
    // billing would otherwise read as cancelling the subscription.
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users', UID), {
        ...COMPLETED_PROFILE, billing: { subscriptionStatus: 'trialing' },
      })
    })
    await assertFails(setDoc(doc(db(UID), 'users', UID), COMPLETED_PROFILE))
  })
})

describe('users/{uid} — ownership', () => {
  it('refuses one doctor writing another profile', async () => {
    await seedStub()
    await assertFails(setDoc(doc(db(OTHER), 'users', UID), COMPLETED_PROFILE, { merge: true }))
  })

  it('refuses one doctor reading another profile', async () => {
    await seedStub()
    await assertFails(getDoc(doc(db(OTHER), 'users', UID)))
  })

  it('refuses a signed-out visitor entirely', async () => {
    await seedStub()
    await assertFails(getDoc(doc(db(null), 'users', UID)))
  })
})
