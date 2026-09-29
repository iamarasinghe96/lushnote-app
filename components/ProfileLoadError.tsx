'use client'

import { useAuth } from '@/hooks/useAuth'

// Shown instead of a page that needs the doctor's profile when it could not be
// read. The alternatives were an endless spinner, or treating the doctor as
// brand new and sending them through onboarding again.
export default function ProfileLoadError() {
  const { signOut } = useAuth()
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-[#f8fafc]">
      <div className="space-y-1">
        <p className="text-base font-semibold text-[var(--text)]">LushNote could not load your account</p>
        <p className="text-sm text-[var(--text2)]">Check your connection, then try again.</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-[var(--r)] bg-[var(--blue)] text-white text-sm font-medium motion-safe:transition-transform motion-safe:active:scale-[0.97]"
        >
          Try again
        </button>
        <button
          onClick={() => { void signOut() }}
          className="px-4 py-2 rounded-[var(--r)] border border-[var(--border)] bg-white text-sm text-[var(--text2)]"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
