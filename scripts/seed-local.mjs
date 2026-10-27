// Made-up data for local mode (scripts/dev-local.mjs), written once into the
// emulators and then kept between runs. Every name and detail is invented.
//
// The shapes follow what the app itself writes. The two account profiles copy
// provisionE2eUser in app/api/admin/releases/route.ts, which is known to land
// straight in the app shell rather than in onboarding.

import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const DAY = 24 * 60 * 60 * 1000

function profile(email, displayName, credentials) {
  return {
    displayName,
    credentials,
    email,
    status: 'active',
    tier: 'free',
    onboardingComplete: true,
    termsAccepted: true,
    // Answers the AI from canned replies while the launcher has the mock on,
    // so local mode works with no AI keys at all. --real-ai turns the mock off.
    e2eFixture: true,
    marketingConsent: false,
    emailOptOut: true,
    activeWorkplaceId: 'local-clinic',
    workplaces: [{ id: 'local-clinic', name: 'Local Test Clinic', type: 'Private Practice', regSystem: 'none', themeIndex: 1 }],
    favoriteTemplateIds: [],
    customTemplates: [],
    // Never paywalled: billing is not what local mode is for.
    billing: { billingExempt: true, updatedAt: Date.now() },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

const PATIENTS = [
  {
    displayName: 'Jordan Sample', dob: '14/03/1988', gender: 'male', urNumber: 'LOCAL001', bedNumber: '4',
    presentingIssue: 'Low mood and poor sleep over six weeks (made-up example).',
    medications: 'Sertraline 50 mg mane', plan: 'Review in two weeks. Sleep diary.', tracked: true,
  },
  {
    displayName: 'Riley Example', dob: '02/11/1975', gender: 'female',
    presentingIssue: 'Worry and restlessness at work (made-up example).',
    medications: 'Nil regular', plan: 'Start CBT referral.',
  },
  {
    displayName: 'Casey Placeholder', dob: '27/07/2001', gender: 'other',
    presentingIssue: 'First visit, history being gathered (made-up example).',
  },
]

function note(userId, clinician, patient, daysAgo, session) {
  const at = Date.now() - daysAgo * DAY
  const d = new Date(at)
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  return {
    userId, patient, clinician, date,
    reg_number: '', time: '09:00 - 09:50', session_number: String(session), attendance: 'Attended',
    diagnosis: 'Made-up example only', presentation: `${patient} attended for a review. This is invented text for local testing.`,
    history: '', medications: '', mse: 'Calm and cooperative. Speech normal. Mood reported as okay.',
    content: 'Discussed sleep, work and supports. All of this is made up.',
    scales: '', risk: 'No risk concerns raised in this made-up session.', referrals: '',
    summary: 'Invented note for trying LushNote locally.', nextsteps: 'Review next week.',
    docType: 'note',
    createdAt: Timestamp.fromMillis(at), updatedAt: Timestamp.fromMillis(at),
  }
}

export async function seed({ projectId, admin, e2e }) {
  if (!getApps().length) initializeApp({ projectId })
  const auth = getAuth()
  const db = getFirestore()

  if ((await db.collection('users').doc(admin.uid).get()).exists) {
    process.stdout.write('[local] Made-up data already there from last time.\n')
    return
  }
  process.stdout.write('[local] Adding made-up doctors, patients and notes...\n')

  for (const a of [admin, e2e]) {
    await auth.deleteUser(a.uid).catch(() => {})
    await auth.createUser({ uid: a.uid, email: a.email, password: a.password, emailVerified: true,
      displayName: a === admin ? 'Dr Alex Local' : 'E2E Tester' })
  }
  await db.collection('users').doc(admin.uid).set(profile(admin.email, 'Dr Alex Local', 'MBBS FRANZCP (made up)'))
  await db.collection('users').doc(e2e.uid).set(profile(e2e.email, 'E2E Tester', 'Automated test account'))

  const batch = db.batch()
  PATIENTS.forEach((p, i) => {
    const at = Date.now() - (i + 1) * 3 * DAY
    batch.set(db.collection('users').doc(admin.uid).collection('patientProfiles').doc(), { ...p, createdAt: at, updatedAt: at })
  })
  PATIENTS.forEach((p, i) => {
    for (let s = 1; s <= 3 - i; s++) {
      batch.set(db.collection('progress_notes').doc(), note(admin.uid, 'Dr Alex Local', p.displayName, (3 - s) * 7 + i, s))
    }
  })
  await batch.commit()
}
