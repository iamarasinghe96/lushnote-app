'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

export function SignedInBar() {
  const { user } = useAuth()
  const router = useRouter()

  // A home-screen install keeps the start URL it was installed with. On iOS
  // that is "/" for every doctor who installed before the app moved to /app,
  // and it never updates, so without this each launch would open the public
  // site mid-clinic. A browser tab gets the bar below instead.
  useEffect(() => {
    if (!user) return
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) router.replace('/app')
  }, [user, router])

  if (!user) return null
  return (
    <div className="bg-[var(--blue)] text-white text-sm px-4 py-2 flex items-center justify-center gap-3 print:hidden">
      <span>You are signed in.</span>
      <Link href="/app" className="font-semibold underline underline-offset-2">Open LushNote</Link>
    </div>
  )
}
