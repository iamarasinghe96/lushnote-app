import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, limit, orderBy, query, setDoc, where, writeBatch } from 'firebase/firestore'

// "Update name on saved notes" (Settings → Profile) reads a doctor's notes by
// clinician name and rewrites that one field in a batch. These pin the two
// queries lib/firestore/notes.ts makes, exactly as it makes them, so a rules
// change that would break the rename, or let it reach another doctor's notes,
// fails here first.

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

const db = (uid: string) => env.authenticatedContext(uid).firestore()

async function seedNote(id: string, userId: string, clinician: string) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'progress_notes', id), {
      userId, patient: 'Patient', clinician, date: '01/09/2026', updatedAt: new Date(),
    })
  })
}

const byClinician = (uid: string, name: string, userId = uid) =>
  query(collection(db(uid), 'progress_notes'), where('userId', '==', userId), where('clinician', '==', name), limit(500))

describe('progress_notes: carrying a rename onto saved notes', () => {
  it('lets a doctor find their own notes by clinician name', async () => {
    await seedNote('a', UID, 'Dr Old')
    await seedNote('b', UID, 'Dr Colleague')
    await seedNote('c', OTHER, 'Dr Old')
    const snap = await assertSucceeds(getDocs(byClinician(UID, 'Dr Old')))
    expect(snap.docs.map(d => d.id)).toEqual(['a'])
  })

  it('lets a doctor page through their own notes to list the names on them', async () => {
    await seedNote('a', UID, 'Dr Old')
    await assertSucceeds(getDocs(query(
      collection(db(UID), 'progress_notes'), where('userId', '==', UID), orderBy('updatedAt', 'desc'), limit(500),
    )))
  })

  it('refuses the same query for another doctor\'s notes', async () => {
    await seedNote('c', OTHER, 'Dr Old')
    await assertFails(getDocs(byClinician(UID, 'Dr Old', OTHER)))
  })

  it('lets a doctor rename the clinician on their own notes in one batch', async () => {
    await seedNote('a', UID, 'Dr Old')
    await seedNote('b', UID, 'Dr Old')
    const fs = db(UID)
    const batch = writeBatch(fs)
    for (const id of ['a', 'b']) batch.update(doc(fs, 'progress_notes', id), { clinician: 'Dr New' })
    await assertSucceeds(batch.commit())
  })

  it('refuses a batch that reaches another doctor\'s note', async () => {
    await seedNote('a', UID, 'Dr Old')
    await seedNote('c', OTHER, 'Dr Old')
    const fs = db(UID)
    const batch = writeBatch(fs)
    for (const id of ['a', 'c']) batch.update(doc(fs, 'progress_notes', id), { clinician: 'Dr New' })
    await assertFails(batch.commit())
  })
})
