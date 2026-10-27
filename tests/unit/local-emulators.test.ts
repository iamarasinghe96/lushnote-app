import { describe, it, expect } from 'vitest'
import { clientUsesEmulators, serverUsesEmulators, EMULATOR_PROJECT_ID } from '@/lib/localEmulators'

// Local mode points the app at Firebase's emulators. Turned on in a real
// deployment it would send every doctor's browser to a database on their own
// localhost, which is to say nowhere, so the double lock is pinned here the same
// way the AI mock's is in e2e-mock.test.ts.

describe('local emulators', () => {
  it('use a demo project, which the emulators never connect to the cloud', () => {
    expect(EMULATOR_PROJECT_ID.startsWith('demo-')).toBe(true)
  })

  it('switch on in the browser only on this machine', () => {
    expect(clientUsesEmulators('1', 'localhost')).toBe(true)
    expect(clientUsesEmulators('1', '127.0.0.1')).toBe(true)
    expect(clientUsesEmulators('1', 'lushnote.com.au')).toBe(false)
    expect(clientUsesEmulators('1', 'lushnote-app-git-preview-x.vercel.app')).toBe(false)
    expect(clientUsesEmulators(undefined, 'localhost')).toBe(false)
  })

  it('switch on in the server never on Vercel', () => {
    expect(serverUsesEmulators({ NEXT_PUBLIC_USE_EMULATORS: '1' })).toBe(true)
    expect(serverUsesEmulators({ NEXT_PUBLIC_USE_EMULATORS: '1', VERCEL: '1' })).toBe(false)
    expect(serverUsesEmulators({})).toBe(false)
  })
})
