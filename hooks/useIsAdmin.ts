'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { hasAdminAccess } from '@/lib/adminAccess'

const OWNER_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

/**
 * Whether the signed-in user may see the admin console: the owner, or someone
 * the owner granted the `admin` claim to. null while that is still being read.
 *
 * This only decides what the browser SHOWS. Every admin API re-checks the
 * verified token on the server (lib/adminGuard.ts), so a tampered browser gains
 * a page of empty panels and nothing else.
 *
 * A grant reaches the browser with the next ID token, so someone made an admin
 * a moment ago needs to sign out and back in (or wait up to an hour).
 */
export function useIsAdmin(): boolean | null {
  const { user, loading } = useAuth()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (loading) { setIsAdmin(null); return }
    if (!user) { setIsAdmin(false); return }
    if (hasAdminAccess(user.uid, null, OWNER_UID)) { setIsAdmin(true); return }
    let cancelled = false
    setIsAdmin(null)
    user.getIdTokenResult()
      .then(r => { if (!cancelled) setIsAdmin(hasAdminAccess(user.uid, r.claims, OWNER_UID)) })
      .catch(() => { if (!cancelled) setIsAdmin(false) })
    return () => { cancelled = true }
  }, [user, loading])

  return isAdmin
}
