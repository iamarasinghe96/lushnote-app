'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { signInErrorMessage } from '@/lib/authErrors'

export function SignInPanel() {
  const { user, loading, signInWithGoogle } = useAuth()
  const router = useRouter()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  // /app decides between the app and an unfinished onboarding.
  useEffect(() => {
    if (!loading && user) router.replace('/app')
  }, [loading, user, router])

  async function handleSignIn() {
    try {
      setSigning(true)
      setError('')
      await signInWithGoogle()
    } catch (err) {
      // A null message means the person simply closed the popup.
      const message = signInErrorMessage((err as { code?: string }).code)
      if (message) setError(message)
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleSignIn}
        disabled={signing}
        className="w-full px-6 py-3 rounded-[var(--r)] bg-[#10b981] text-white font-semibold text-sm hover:bg-[#059669]
                   motion-safe:transition-colors motion-safe:active:scale-[0.97] disabled:opacity-50"
      >
        {signing ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  )
}
