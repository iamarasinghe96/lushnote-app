'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { NoteStoreProvider } from '@/hooks/useNoteStore'
import TabBar from '@/components/tabs/TabBar'

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0][0] ?? '').toUpperCase()
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace('/'); return }
    if (!profile?.onboardingComplete) router.replace('/onboarding')
  }, [loading, user, profile, router])

  useEffect(() => {
    if (!menuOpen) return
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [menuOpen])

  useEffect(() => { setMenuOpen(false) }, [pathname])

  async function handleSignOut() {
    await signOut()
    router.replace('/')
  }

  if (loading) return <LoadingScreen />
  if (!user || !profile?.onboardingComplete) return null

  const initials = getInitials(profile.displayName || user.email || '?')

  return (
    <NoteStoreProvider>
      <div className="flex flex-col overflow-hidden bg-[var(--bg)]" style={{ height: '100dvh' }}>

        {/* ── Header ── */}
        <header
          className="relative z-30 flex items-center justify-between px-4 shrink-0
                     backdrop-blur-lg bg-white/85 border-b border-white/50"
          style={{
            height: 52,
            boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
          }}
        >
          <Link href="/generate" className="flex items-center gap-2 select-none">
            <img src="/icon.svg" alt="" width={28} height={28} aria-hidden />
            <span className="font-semibold text-[var(--text)] text-[15px]">LushNote</span>
          </Link>

          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-label="User menu"
              className="w-8 h-8 rounded-full bg-[#10b981] flex items-center justify-center
                         text-white text-xs font-bold active:scale-95 transition-transform"
            >
              {initials}
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-10 w-52 rounded-xl bg-white
                           border border-[var(--border)] py-1 z-40"
                style={{ boxShadow: 'var(--shadow-lg)' }}
              >
                <p className="px-3 py-2 text-xs text-[var(--text3)] truncate select-none">
                  {user.email}
                </p>
                <div className="h-px bg-[var(--border)] mx-2 my-1" />
                <Link
                  href="/settings"
                  className="block px-3 py-2 text-sm text-[var(--text)]
                             hover:bg-[var(--bg)] rounded-lg mx-1"
                >
                  Settings
                </Link>
                <button
                  onClick={handleSignOut}
                  className="w-full text-left px-3 py-2 text-sm text-[var(--danger)]
                             hover:bg-[var(--bg)] rounded-lg mx-1"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ── Content ── */}
        <main className="flex-1 overflow-hidden relative">
          <div key={pathname} className="animate-fade-in h-full" style={{ willChange: 'opacity' }}>
            {children}
          </div>
        </main>

        {/* ── Tab bar ── */}
        <TabBar />

      </div>
    </NoteStoreProvider>
  )
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[#10b981]" aria-hidden>
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
