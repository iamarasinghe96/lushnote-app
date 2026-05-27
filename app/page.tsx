'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

export default function Page() {
  const { user, profile, loading, signInWithGoogle } = useAuth()
  const router = useRouter()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (user && profile?.onboardingComplete) {
      router.replace('/generate')
    } else if (user && !profile?.onboardingComplete) {
      router.replace('/onboarding')
    }
  }, [loading, user, profile, router])

  if (loading || user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <Spinner />
      </div>
    )
  }

  async function handleSignIn() {
    try {
      setSigning(true)
      setError('')
      await signInWithGoogle()
    } catch {
      setError('Sign-in failed. Please try again.')
    } finally {
      setSigning(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#f8fafc] px-4">
      <div className="flex flex-col items-center gap-6 text-center">
        <img src="/icon.svg" alt="LushNote" width={72} height={72} />
        <div>
          <h1 className="text-3xl font-bold text-[#0f172a]">LushNote</h1>
          <p className="mt-1 text-[#475569]">Clinical note builder for psychiatrists</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={handleSignIn}
          disabled={signing}
          className="flex items-center gap-3 rounded-xl border border-[#e2e8f0] bg-white px-6 py-3 text-sm font-medium text-[#0f172a] shadow-sm transition active:scale-95 disabled:opacity-60"
        >
          {signing ? <Spinner size={18} /> : <GoogleLogo />}
          Sign in with Google
        </button>
      </div>
    </main>
  )
}

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin text-[#10b981]"
      aria-hidden
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"
      />
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}
