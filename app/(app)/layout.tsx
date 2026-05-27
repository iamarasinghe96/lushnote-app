'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

function Spinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[#10b981]" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/')
      return
    }
    if (!profile?.onboardingComplete) {
      router.replace('/onboarding')
    }
  }, [loading, user, profile, router])

  if (loading) return <Spinner />
  if (!user || !profile?.onboardingComplete) return null

  return <>{children}</>
}
