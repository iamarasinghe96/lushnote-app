'use client'

import { useEffect, useState } from 'react'

// Plain confirmation page for the link in the lifecycle emails. Deliberately
// standalone: no auth, no app shell, nothing to sign into.
export default function UnsubscribePage() {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    fetch(`/api/unsubscribe?u=${encodeURIComponent(q.get('u') ?? '')}&t=${encodeURIComponent(q.get('t') ?? '')}`)
      .then(async res => {
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (res.ok) { setState('done'); return }
        setState('failed')
        setMessage(data.error || 'That link could not be processed.')
      })
      .catch(() => { setState('failed'); setMessage('Could not reach LushNote. Please try again.') })
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[var(--bg)]">
      <div className="max-w-md w-full rounded-[var(--r-lg)] bg-white border border-[var(--border)] p-6 text-center"
           style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}>
        <h1 className="text-lg font-bold text-[var(--text)]">
          {state === 'working' ? 'One moment…' : state === 'done' ? "You're unsubscribed" : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-sm text-[var(--text2)]">
          {state === 'working' && 'Updating your preference.'}
          {state === 'done' && 'You will no longer receive account emails from LushNote. Your account and your notes are untouched, and you can still use the app exactly as before.'}
          {state === 'failed' && message}
        </p>
        <a href="https://lushnote.com.au" className="inline-block mt-5 text-sm font-medium text-[var(--blue)]">
          Back to LushNote
        </a>
      </div>
    </main>
  )
}
