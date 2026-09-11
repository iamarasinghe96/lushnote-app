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
  async headers() {
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
      "img-src 'self' data: blob: https:",
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
      ].join(' '),
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      // The card and BECS fields are iframes served from js.stripe.com - that
      // cross-origin boundary is the whole reason the numbers never touch this
      // page. hooks.stripe.com is where a bank's 3DS challenge opens.
      "frame-src 'self' https://accounts.google.com https://lush-note.firebaseapp.com https://js.stripe.com https://hooks.stripe.com",
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
    ]
  },
}

export default nextConfig
