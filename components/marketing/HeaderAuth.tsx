'use client'

import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { PRIMARY_CTA } from './Page'

// The server renders the signed-out version, which is what a crawler and most
// visitors should see. A signed-in doctor gets the way back into the app as
// soon as Firebase restores their session.
export function HeaderAuth() {
  const { user } = useAuth()
  if (user) return <Link href="/app" className={PRIMARY_CTA}>Open LushNote</Link>
  return (
    <>
      <Link href="/login" className="hidden sm:inline px-3 py-2 text-sm font-medium text-[var(--text2)] hover:text-[var(--text)]">
        Log in
      </Link>
      <Link href="/login" className={PRIMARY_CTA}>Start free trial</Link>
    </>
  )
}
