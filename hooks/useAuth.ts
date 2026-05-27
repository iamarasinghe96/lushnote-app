'use client'

import { useAuthContext, type AuthContextValue } from '@/components/AuthProvider'

export function useAuth(): AuthContextValue {
  return useAuthContext()
}
