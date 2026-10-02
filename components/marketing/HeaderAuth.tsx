'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { signInErrorMessage } from '@/lib/authErrors'
import { PRIMARY_CTA } from './Page'

// The server renders the signed-out version, which is what a crawler and most
// visitors should see. A signed-in doctor gets the way back into the app as
// soon as Firebase restores their session.
//
// Both buttons open Google directly, as the landing page's do. They used to be
// links to /login, which did nothing at all when the doctor was already there.
export function HeaderAuth() {
  const { user, signInWithGoogle } = useAuth()
  const router = useRouter()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  if (user) return <Link href="/app" className={PRIMARY_CTA}>Open LushNote</Link>

  async function start() {
    try {
      setSigning(true)
      setError('')
      await signInWithGoogle()
      // /app decides between the app and an unfinished onboarding.
      router.replace('/app')
    } catch (err) {
      // A null message means the person simply closed the popup.
      const message = signInErrorMessage((err as { code?: string }).code)
      if (message) setError(message)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={start}
        disabled={signing}
        className="hidden sm:inline px-3 py-2 text-sm font-medium text-[var(--text2)] hover:text-[var(--text)] disabled:opacity-50"
      >
        Log in
      </button>
      <button onClick={start} disabled={signing} className={`${PRIMARY_CTA} disabled:opacity-50`}>
        {signing ? 'Signing in…' : 'Start free trial'}
      </button>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full mt-2 w-72 rounded-[var(--r)] border border-[var(--border)] bg-white p-3
                     text-sm text-[var(--danger)] shadow-lg"
        >
          {error}
        </p>
      )}
    </div>
  )
}
