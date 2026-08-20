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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://apis.google.com https://accounts.google.com",
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
