// The signed-in app moved under /app so the public site could own the root.
// The old paths still arrive from bookmarks, installed home-screen apps, emails
// already sitting in inboxes, and Stripe's return URLs, so each one forwards,
// query string included. Temporary (307) on purpose: a browser caches a 308
// forever, which would strand people if the move were ever rolled back.
const MOVED_TO_APP = ['generate', 'edit', 'transcript', 'history', 'patients', 'export', 'settings', 'billing', 'onboarding']

// Only the production deployment may be indexed. Vercel sets VERCEL_ENV to
// 'preview' for every branch build, including the owner's `preview` alias.
const INDEXABLE = process.env.VERCEL_ENV === 'production'

// Firebase's sign-in iframe is served from the project's auth domain, so the
// frame-src has to name it. Production's is listed outright; this adds the one
// the build is configured with, because staging runs on its own Firebase
// project and its sign-in would otherwise be refused by the browser with
// nothing on the page to say why. Only a bare hostname is accepted: the value
// is spliced into the policy, and anything else could widen it.
function firebaseAuthOrigin() {
  const host = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '').trim().toLowerCase()
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? `https://${host}` : null
}

// Local mode (npm run dev:local) talks to Firebase's emulators over plain http
// on this machine. Same double lock as lib/localEmulators.ts, which this file
// cannot import: the flag, and not being on Vercel. A build on Vercel never
// gets these hosts in its policy, whatever is ticked there.
function emulatorOrigins() {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS !== '1' || process.env.VERCEL) return []
  return ['127.0.0.1', 'localhost'].flatMap(h => [9099, 8080, 9199].map(p => `http://${h}:${p}`))
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Evaluated once when Vercel builds, so /api/version reports when this
  // deployment was made rather than when the serverless instance woke up.
  env: {
    BUILT_AT: new Date().toISOString(),
  },
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
  async redirects() {
    return [
      // /app itself has no page. The shell's guard then sends a signed-out
      // visitor to /login and an unfinished signup to /app/onboarding.
      { source: '/app', destination: '/app/generate', permanent: false },
      ...MOVED_TO_APP.map(p => ({ source: `/${p}`, destination: `/app/${p}`, permanent: false })),
    ]
  },
  async headers() {
    const local = emulatorOrigins()
    const csp = [
      "default-src 'self'",
      // js.stripe.com is where loadStripe() injects its script tag. Without it
      // the browser refuses the tag outright, loadStripe never resolves, and the
      // Payment Element renders nothing - which looks exactly like an ad-blocker
      // and was misdiagnosed as one. Stripe requires the script be loaded from
      // their domain; it cannot be bundled or self-hosted.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://apis.google.com https://accounts.google.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // blob: is needed for locally-created previews (the scanned-page thumbnails
      // come from URL.createObjectURL and were being blocked outright). Same
      // origin-only guarantee as media-src/worker-src, which already allow it.
      ["img-src 'self' data: blob: https:", ...local].join(' '),
      [
        "connect-src 'self'",
        "https://*.googleapis.com",
        "https://*.google.com",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://firestore.googleapis.com",
        "https://generativelanguage.googleapis.com",
        "https://api.groq.com",
        "https://apis.google.com",
        "https://accounts.google.com",
        // api.stripe.com receives the card and bank details straight from the
        // Element, which is what keeps them out of this app entirely. r.stripe.com
        // is the fraud signal Radar scores against; blocking it does not stop a
        // payment but does weaken the check on it.
        "https://api.stripe.com",
        "https://r.stripe.com",
        ...local,
      ].join(' '),
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      // The card and BECS fields are iframes served from js.stripe.com - that
      // cross-origin boundary is the whole reason the numbers never touch this
      // page. hooks.stripe.com is where a bank's 3DS challenge opens.
      [
        "frame-src 'self' https://accounts.google.com https://lush-note.firebaseapp.com https://js.stripe.com https://hooks.stripe.com",
        firebaseAuthOrigin(),
        ...local,
      ].filter(s => s && s !== 'https://lush-note.firebaseapp.com').join(' '),
      "frame-ancestors 'none'",
    ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'microphone=(self), geolocation=(), display-capture=(self)' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      ...(INDEXABLE ? [] : [{
        source: '/(.*)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      }]),
      {
        source: '/app/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]
  },
}

export default nextConfig
