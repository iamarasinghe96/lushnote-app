/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
  // Serve Firebase Auth's sign-in helper from our OWN origin by proxying the
  // reserved __/auth and __/firebase paths to the project's firebaseapp.com
  // handler. Combined with authDomain === our own host (see lib/firebase.ts),
  // signInWithPopup/Redirect runs same-origin and is no longer broken by Safari /
  // in-app-browser storage partitioning ("missing initial state"). The
  // destination is ALWAYS the firebaseapp.com handler (never authDomain, which is
  // now our own host) to avoid a proxy loop.
  async rewrites() {
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    if (!projectId) return []
    const handler = `https://${projectId}.firebaseapp.com`
    return [
      { source: '/__/auth/:path*', destination: `${handler}/__/auth/:path*` },
      { source: '/__/firebase/:path*', destination: `${handler}/__/firebase/:path*` },
    ]
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://apis.google.com https://accounts.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
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
      ].join(' '),
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "frame-src 'self' https://accounts.google.com https://lush-note.firebaseapp.com",
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
