'use client'

// Reports a short, scrubbed event to /api/log for the admin Logs panel.
//
// The route attributes an entry to a doctor only from this token, never from a
// uid in the body, so an entry cannot be pinned on someone else. Reporting is
// best-effort: a failed token or request is dropped, never thrown at the caller.
//
// Scalar fields only. Never a transcript, a note, a request body or a stack.

import { auth } from '@/lib/firebase'

export function reportToLog(entry: { level: 'error' | 'warn' | 'info'; tag: string; route: string; message: string }): void {
  void (async () => {
    try {
      const token = await auth.currentUser?.getIdToken()
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(entry),
      })
    } catch { /* reporting must never break the thing it reports on */ }
  })()
}
