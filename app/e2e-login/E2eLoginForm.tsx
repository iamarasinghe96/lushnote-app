'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '@/lib/firebase'

export default function E2eLoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      router.replace('/generate')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#f8fafc]">
      <form onSubmit={submit} data-testid="e2e-login-form" className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
        <h1 className="text-lg font-semibold text-slate-900">Automated test sign-in</h1>
        <p className="mt-1 text-sm text-slate-500">Preview deployments only.</p>

        <label className="block mt-5 text-sm font-medium text-slate-700" htmlFor="e2e-email">Email</label>
        <input
          id="e2e-email" data-testid="e2e-email" type="email" autoComplete="off" required
          value={email} onChange={e => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />

        <label className="block mt-4 text-sm font-medium text-slate-700" htmlFor="e2e-password">Password</label>
        <input
          id="e2e-password" data-testid="e2e-password" type="password" autoComplete="off" required
          value={password} onChange={e => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />

        {error && <p data-testid="e2e-login-error" className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          type="submit" disabled={busy} data-testid="e2e-submit"
          className="mt-5 w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
