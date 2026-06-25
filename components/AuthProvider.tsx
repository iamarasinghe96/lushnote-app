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
import { getProfile } from '@/lib/firestore/profiles'
import type { User } from '@/types'

export interface AuthContextValue {
  user: FirebaseUser | null
  profile: User | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!cancelled) setUser(firebaseUser)

      if (firebaseUser) {
        const p = await getProfile(firebaseUser.uid)
        if (!cancelled) {
          setProfile(p)
          if (p?.groqApiKey && !sessionStorage.getItem('groq_api_key')) {
            sessionStorage.setItem('groq_api_key', p.groqApiKey)
          }
          if (p?.geminiApiKey && !sessionStorage.getItem('gemini_api_key')) {
            sessionStorage.setItem('gemini_api_key', p.geminiApiKey)
          }
        }
      } else {
        if (!cancelled) setProfile(null)
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
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
