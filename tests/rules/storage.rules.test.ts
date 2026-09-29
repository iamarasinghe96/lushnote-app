import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { ref, uploadBytes, getMetadata } from 'firebase/storage'

// storage.rules, against the real Storage emulator. Until these rules lived in
// the repo the only copy was in the Firebase console, and it let any signed-in
// account download any doctor's signature and letterhead photos by uid.

const UID = 'doctor-1'
const OTHER = 'doctor-2'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'lush-note-rules-test',
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  })
})

afterAll(async () => { await env?.cleanup() })
beforeEach(async () => { await env.clearStorage() })

const storage = (uid: string | null) =>
  (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage()

const bytes = (n: number) => new Uint8Array(n)
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')

async function seed(path: string, data: Uint8Array, contentType: string) {
  await env.withSecurityRulesDisabled(async ctx => {
    await uploadBytes(ref(ctx.storage(), path), data, { contentType })
  })
}

describe('signatures/{uid}/signature.svg', () => {
  const path = (uid: string) => `signatures/${uid}/signature.svg`

  it('lets a doctor save and read back their own signature', async () => {
    await assertSucceeds(uploadBytes(ref(storage(UID), path(UID)), SVG, { contentType: 'image/svg+xml' }))
    await assertSucceeds(getMetadata(ref(storage(UID), path(UID))))
  })

  it("refuses one doctor reading another doctor's signature", async () => {
    await seed(path(UID), SVG, 'image/svg+xml')
    await assertFails(getMetadata(ref(storage(OTHER), path(UID))))
  })

  it('refuses a signed-out read', async () => {
    await seed(path(UID), SVG, 'image/svg+xml')
    await assertFails(getMetadata(ref(storage(null), path(UID))))
  })

  it("refuses one doctor replacing another doctor's signature", async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), path(UID)), SVG, { contentType: 'image/svg+xml' }))
  })

  it('refuses anything that is not an SVG', async () => {
    await assertFails(uploadBytes(ref(storage(UID), path(UID)), SVG, { contentType: 'text/html' }))
  })

  it('refuses a signature of 5 MB or more', async () => {
    await assertFails(uploadBytes(ref(storage(UID), path(UID)), bytes(5 * 1024 * 1024), { contentType: 'image/svg+xml' }))
  })
})

describe('letterhead-requests/{uid}', () => {
  const path = (uid: string) => `letterhead-requests/${uid}/clinic-header.png`

  it('lets a doctor attach and read back their own letterhead photo', async () => {
    await assertSucceeds(uploadBytes(ref(storage(UID), path(UID)), bytes(1024), { contentType: 'image/png' }))
    await assertSucceeds(getMetadata(ref(storage(UID), path(UID))))
  })

  it('accepts the image types a phone produces', async () => {
    await assertSucceeds(uploadBytes(ref(storage(UID), path(UID)), bytes(1024), { contentType: 'image/heic' }))
  })

  it("refuses one doctor reading another doctor's letterhead photo", async () => {
    await seed(path(UID), bytes(1024), 'image/png')
    await assertFails(getMetadata(ref(storage(OTHER), path(UID))))
  })

  it("refuses one doctor writing into another doctor's folder", async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), path(UID)), bytes(1024), { contentType: 'image/png' }))
  })

  it('refuses anything that is not an image', async () => {
    await assertFails(uploadBytes(ref(storage(UID), path(UID)), bytes(1024), { contentType: 'text/html' }))
  })

  it('refuses a file of 20 MB or more', async () => {
    await assertFails(uploadBytes(ref(storage(UID), path(UID)), bytes(20 * 1024 * 1024), { contentType: 'image/png' }))
  })
})

describe('recordings/{uid}', () => {
  const path = (uid: string) => `recordings/${uid}/session-1/0000.webm`

  it('lets a doctor upload their own audio segment', async () => {
    await assertSucceeds(uploadBytes(ref(storage(UID), path(UID)), bytes(1024), { contentType: 'audio/webm;codecs=opus' }))
  })

  it('never lets a browser read audio back, not even the owner', async () => {
    await seed(path(UID), bytes(1024), 'audio/webm')
    await assertFails(getMetadata(ref(storage(UID), path(UID))))
  })

  it("refuses one doctor uploading into another doctor's recordings", async () => {
    await assertFails(uploadBytes(ref(storage(OTHER), path(UID)), bytes(1024), { contentType: 'audio/webm' }))
  })

  it('refuses anything that is not audio', async () => {
    await assertFails(uploadBytes(ref(storage(UID), path(UID)), bytes(1024), { contentType: 'text/html' }))
  })
})

describe('letterheads and everything else', () => {
  it('lets anyone read a published letterhead, including signed out', async () => {
    await seed('letterheads/clinic/header.png', bytes(1024), 'image/png')
    await assertSucceeds(getMetadata(ref(storage(null), 'letterheads/clinic/header.png')))
  })

  it('refuses a browser publishing a letterhead', async () => {
    await assertFails(uploadBytes(ref(storage(UID), 'letterheads/clinic/header.png'), bytes(1024), { contentType: 'image/png' }))
  })

  it('refuses any path the rules do not name', async () => {
    await assertFails(uploadBytes(ref(storage(UID), `uploads/${UID}/file.png`), bytes(1024), { contentType: 'image/png' }))
  })
})
