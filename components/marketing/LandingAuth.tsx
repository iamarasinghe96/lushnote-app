'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { signInErrorMessage } from '@/lib/authErrors'

// The landing page is server-rendered so its content is in the HTML a search
// engine reads. These are its only interactive parts: the sign-in buttons,
// which open Google directly as they always have, and the error line under
// the hero. They share one state so any button shows "Signing in…".

interface LandingAuthState {
  signing: boolean
  error: string
  signedIn: boolean
  start: () => void
}

const Ctx = createContext<LandingAuthState | null>(null)

export function LandingAuth({ children }: { children: ReactNode }) {
  const { user, signInWithGoogle } = useAuth()
  const router = useRouter()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  // A home-screen install keeps the start URL it was installed with. On iOS
  // that is "/" for every doctor who installed before the app moved to /app,
  // and it never updates, so without this each launch would open this page.
  useEffect(() => {
    if (!user) return
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) router.replace('/app')
  }, [user, router])

  async function start() {
    if (user) { router.push('/app'); return }
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

  return <Ctx.Provider value={{ signing, error, signedIn: !!user, start }}>{children}</Ctx.Provider>
}

export function LandingButton({ label, busyLabel, hideWhenSignedIn, className }: {
  label: string
  busyLabel?: string
  hideWhenSignedIn?: boolean
  className: string
}) {
  const c = useContext(Ctx)!
  if (hideWhenSignedIn && c.signedIn) return null
  return (
    <button onClick={c.start} disabled={c.signing} className={className}>
      {c.signing && busyLabel ? busyLabel : c.signedIn ? 'Open LushNote' : label}
    </button>
  )
}

export function LandingError() {
  const c = useContext(Ctx)!
  return c.error ? <p className="text-sm text-[var(--danger)]">{c.error}</p> : null
}
