import { afterEach, describe, it, expect } from 'vitest'
import nextConfig from '../../next.config.mjs'

// The Content-Security-Policy is the one piece of configuration that can break a
// third party completely while every test, every type check and every build stays
// green - nothing in this repo executes it, the browser does.
//
// It did exactly that: Stripe was absent from script-src, so the browser refused
// the tag loadStripe injects, the Payment Element rendered an empty box, and the
// Save button could never enable. No doctor could subscribe. The on-screen message
// blamed an ad-blocker, because from inside the page a refused script and a blocked
// one are indistinguishable, and that sent the person debugging it through their
// extensions instead of this file.
//
// So these assert the host list rather than the string: a directive that loses an
// entry fails here instead of in production.

async function directives(): Promise<Record<string, string>> {
  const headers = await nextConfig.headers!()
  const csp = headers
    .flatMap(h => h.headers)
    .find(h => h.key === 'Content-Security-Policy')
  if (!csp) throw new Error('no Content-Security-Policy header is set')

  const out: Record<string, string> = {}
  for (const part of csp.value.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const name = trimmed.split(/\s+/)[0]
    out[name] = trimmed
  }
  return out
}

describe('Content-Security-Policy', () => {
  it('is served on every route', async () => {
    const headers = await nextConfig.headers!()
    expect(headers.some(h => h.source === '/(.*)')).toBe(true)
    await expect(directives()).resolves.toBeTruthy()
  })

  // Stripe.js cannot be bundled or self-hosted - Stripe requires it be fetched
  // from their domain, which is what keeps card numbers out of this origin. So
  // the policy has to name them, and each directive covers a different piece.
  it('lets Stripe.js load', async () => {
    expect((await directives())['script-src']).toContain('https://js.stripe.com')
  })

  it('lets the card and BECS fields mount, and a 3DS challenge open', async () => {
    const frame = (await directives())['frame-src']
    expect(frame).toContain('https://js.stripe.com')
    expect(frame).toContain('https://hooks.stripe.com')
  })

  it('lets the details reach Stripe rather than this app', async () => {
    expect((await directives())['connect-src']).toContain('https://api.stripe.com')
  })

  // Firebase is the other total-failure case: block these and nobody signs in.
  it('still allows Firebase auth and Firestore', async () => {
    const d = await directives()
    expect(d['connect-src']).toContain('https://*.googleapis.com')
    expect(d['script-src']).toContain('https://www.gstatic.com')
    expect(d['frame-src']).toContain('https://lush-note.firebaseapp.com')
  })

  // Staging runs on its own Firebase project, whose sign-in iframe lives on a
  // different auth domain. Without it in frame-src the Google sign-in on
  // staging fails in the browser while every check here stays green.
  describe('the configured Firebase auth domain', () => {
    const before = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
    afterEach(() => {
      if (before === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
      else process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = before
    })

    it('is allowed to frame the sign-in', async () => {
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'lush-note-staging.firebaseapp.com'
      const frame = (await directives())['frame-src']
      expect(frame).toContain('https://lush-note-staging.firebaseapp.com')
      expect(frame).toContain('https://lush-note.firebaseapp.com')
    })

    it('is not listed twice when it is production\'s', async () => {
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'lush-note.firebaseapp.com'
      const frame = (await directives())['frame-src'].split(/\s+/)
      expect(frame.filter(s => s === 'https://lush-note.firebaseapp.com')).toHaveLength(1)
    })

    it('cannot smuggle anything else into the policy', async () => {
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'x.firebaseapp.com; script-src *'
      const d = await directives()
      expect(d['frame-src']).not.toContain('x.firebaseapp.com')
      expect(d['script-src']).not.toContain('*')
    })
  })

  // Local mode talks to Firebase's emulators over plain http on the developer's
  // machine. Those hosts must reach a local build and never a Vercel one: on a
  // deployment they would let any page talk to whatever answers on localhost.
  describe('local emulator hosts', () => {
    const flag = process.env.NEXT_PUBLIC_USE_EMULATORS
    const vercel = process.env.VERCEL
    afterEach(() => {
      if (flag === undefined) delete process.env.NEXT_PUBLIC_USE_EMULATORS
      else process.env.NEXT_PUBLIC_USE_EMULATORS = flag
      if (vercel === undefined) delete process.env.VERCEL
      else process.env.VERCEL = vercel
    })

    it('are allowed in local mode', async () => {
      process.env.NEXT_PUBLIC_USE_EMULATORS = '1'
      delete process.env.VERCEL
      const d = await directives()
      expect(d['connect-src']).toContain('http://127.0.0.1:8080')
      expect(d['frame-src']).toContain('http://127.0.0.1:9099')
      expect(d['img-src']).toContain('http://127.0.0.1:9199')
    })

    it('never reach a Vercel build, even with the flag ticked', async () => {
      process.env.NEXT_PUBLIC_USE_EMULATORS = '1'
      process.env.VERCEL = '1'
      const d = await directives()
      for (const name of ['connect-src', 'frame-src', 'img-src']) expect(d[name]).not.toContain('http://')
    })

    it('are absent without the flag', async () => {
      delete process.env.NEXT_PUBLIC_USE_EMULATORS
      delete process.env.VERCEL
      expect((await directives())['connect-src']).not.toContain('http://')
    })
  })

  // The reason the policy exists at all. A regression that widened one of these
  // to * would leave every assertion above passing.
  it('does not fall back to allowing anything', async () => {
    const d = await directives()
    expect(d['default-src']).toBe("default-src 'self'")
    expect(d['frame-ancestors']).toBe("frame-ancestors 'none'")
    for (const name of ['script-src', 'connect-src', 'frame-src']) {
      expect(d[name].split(/\s+/)).not.toContain('*')
    }
  })
})
