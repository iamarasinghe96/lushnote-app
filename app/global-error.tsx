'use client'

import { useEffect } from 'react'

// Root error boundary. Catches otherwise-unhandled render crashes, reports a
// SCRUBBED message (name + message only, never a stack carrying data) to the log
// sink so it surfaces in the admin Logs panel, and shows a minimal recover UI.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      const message = `${error.name}: ${error.message}`.slice(0, 1000)
      const route = typeof window !== 'undefined' ? window.location.pathname : 'client'
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, route }),
        keepalive: true,
      }).catch(() => {})
    } catch { /* reporting must never throw */ }
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '9999px', background: '#5ad6a7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>LN</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#475569', margin: 0, maxWidth: 360 }}>
            The app hit an unexpected error. Your notes are saved. Try again, and if it keeps happening, reach out at admin@lushnote.com.au.
          </p>
          <button
            onClick={() => reset()}
            style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
