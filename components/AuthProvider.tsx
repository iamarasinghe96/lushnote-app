'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { getProfile, ensureProfileStub } from '@/lib/firestore/profiles'
import { sanitizeApiKey } from '@/lib/utils'
import type { User } from '@/types'

export interface AuthContextValue {
  user: FirebaseUser | null
  profile: User | null
  loading: boolean
  /** Signed in, but the profile could not be read (offline, Firestore
   *  unreachable). NOT the same as having no profile: pages that would send a
   *  profile-less doctor to onboarding must show a retry instead. */
  profileError: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!cancelled) setUser(firebaseUser)

      if (firebaseUser) {
        let p: User | null
        try {
          p = await getProfile(firebaseUser.uid)
        } catch {
          // The read failed, so whether a profile exists is unknown. Rejecting
          // here used to skip setLoading(false) and leave an endless spinner;
          // reporting "no profile" instead would send an onboarded doctor back
          // through onboarding, where finishing it overwrites their profile.
          if (!cancelled) { setProfile(null); setProfileError(true); setLoading(false) }
          return
        }
        // First authentication: leave a stub so a signup abandoned partway is
        // still a record we can see and reach, instead of vanishing.
        if (!p) {
          await ensureProfileStub(firebaseUser.uid, firebaseUser.email ?? '', firebaseUser.displayName ?? '').catch(() => {})
          p = await getProfile(firebaseUser.uid).catch(() => null)
        }
        if (!cancelled) {
          setProfile(p)
          setProfileError(false)
          if (p?.groqApiKey && !sessionStorage.getItem('groq_api_key')) {
            sessionStorage.setItem('groq_api_key', sanitizeApiKey(p.groqApiKey))
          }
          if (p?.geminiApiKey && !sessionStorage.getItem('gemini_api_key')) {
            sessionStorage.setItem('gemini_api_key', sanitizeApiKey(p.geminiApiKey))
          }
        }
      } else {
        if (!cancelled) { setProfile(null); setProfileError(false) }
      }

      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  async function signInWithGoogle() {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    await signInWithPopup(auth, provider)
  }

  async function signOut() {
    sessionStorage.removeItem('groq_api_key')
    sessionStorage.removeItem('gemini_api_key')
    localStorage.removeItem('ln_groq_tokens_session')
    await firebaseSignOut(auth)
  }

  async function refreshProfile() {
    if (!user) return
    const p = await getProfile(user.uid)
    setProfile(p)
    setProfileError(false)
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, profileError, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
