'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { NoteStoreProvider, useNoteStore } from '@/hooks/useNoteStore'
import TabBar from '@/components/tabs/TabBar'
import { FAB } from '@/components/FAB'
import { RateLimitBanner } from '@/components/ui/RateLimitBanner'
import { getInitials, applyWorkspaceTheme } from '@/lib/utils'
import { getLetterhead } from '@/lib/firestore/letterheads'
import { WP_THEMES } from '@/types'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NoteStoreProvider>
      <AppContent>{children}</AppContent>
    </NoteStoreProvider>
  )
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth()
  const store = useNoteStore()
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rateLimitWait, setRateLimitWait] = useState<number | null>(null)
  const [pendingRetry, setPendingRetry] = useState<(() => void) | null>(null)
  const [toast, setToast] = useState<string | null>(null)

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

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    function handler(e: Event) {
      const { waitSeconds } = (e as CustomEvent<{ waitSeconds: number }>).detail
      if (waitSeconds > 120) {
        setToast('Daily Groq limit reached. Resets at midnight UTC.')
      } else {
        setRateLimitWait(waitSeconds)
      }
    }
    window.addEventListener('groq-rate-limit', handler)
    return () => window.removeEventListener('groq-rate-limit', handler)
  }, [])

  useEffect(() => {
    if (!profile) return
    const wp = profile.workplaces?.find(w => w.id === profile.activeWorkplaceId)
    applyWorkspaceTheme(wp?.themeIndex ?? 0)
  }, [profile])

  // Load shared letterhead for active workplace into NoteStore
  useEffect(() => {
    if (!profile) return
    const activeWp = profile.workplaces?.find(w => w.id === profile.activeWorkplaceId)
    if (!activeWp?.name) { store.setActiveLetterhead(null); return }
    getLetterhead(activeWp.name).then(lh => store.setActiveLetterhead(lh))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.activeWorkplaceId])

  async function handleSignOut() {
    await signOut()
    router.replace('/')
  }

  if (loading) return <LoadingScreen />
  if (!user || !profile?.onboardingComplete) return null

  const activeWorkplace = profile?.workplaces?.find(w => w.id === profile.activeWorkplaceId)
  const themeIndex = activeWorkplace?.themeIndex ?? 0
  const avatarBg = WP_THEMES[themeIndex]?.primary ?? '#2563eb'
  const initials = getInitials(profile?.displayName || '')

  return (
    <div className="flex flex-col overflow-hidden bg-[var(--bg)]" style={{ height: '100dvh' }}>

      {/* ── Header ── */}
      <header
        data-header
        className="relative z-30 flex items-center justify-between px-4 shrink-0"
        style={{
          height: 52,
          background: 'linear-gradient(to right, #1d4ed8, #2563eb)',
          boxShadow: '0 2px 8px rgba(15,23,42,.12)',
        }}
      >
        {/* Left: LN circle + name/subtitle */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#5ad6a7] flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold select-none">LN</span>
          </div>
          {profile && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-white leading-tight truncate max-w-[200px] sm:max-w-xs">
                {profile.displayName}
              </span>
              <span className="text-xs text-white/70 leading-tight truncate max-w-[200px] sm:max-w-xs">
                {[profile.credentials, activeWorkplace?.name].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
        </div>

        {/* Right: LushNote wordmark + avatar */}
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold text-sm hidden sm:block select-none">LushNote</span>
          <div ref={menuRef} className="relative">
            <button
              style={{ backgroundColor: avatarBg }}
              className="w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0
                         motion-safe:transition-transform motion-safe:active:scale-95"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="User menu"
            >
              {initials}
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-10 w-52 rounded-xl bg-white
                           border border-[var(--border)] py-1 z-40"
                style={{ boxShadow: 'var(--shadow-lg)' }}
              >
                <div className="px-3 py-2 text-xs text-[var(--text3)] border-b border-[var(--border)] truncate select-none">
                  {user.email}
                </div>

                {([
                  { label: 'Profile',         tab: 'profile' },
                  { label: 'Workplaces',      tab: 'workplaces' },
                  { label: 'Templates',       tab: 'templates' },
                  { label: 'Transcripts',     tab: 'transcripts' },
                  { label: 'API Keys',        tab: 'api-keys' },
                  { label: 'Personalisation', tab: 'personalisation' },
                  { label: 'Subscription',    tab: 'subscription' },
                ] as const).map(({ label, tab }) => (
                  <Link
                    key={tab}
                    href={`/settings?tab=${tab}`}
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)] rounded-lg mx-1"
                  >
                    {label}
                  </Link>
                ))}

                <div className="h-px bg-[var(--border)] mx-2 my-1" />

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
        </div>
      </header>

      {/* ── Rate limit banner ── */}
      {rateLimitWait !== null && (
        <RateLimitBanner
          waitSeconds={rateLimitWait}
          onDismiss={() => setRateLimitWait(null)}
          onRetry={() => { setRateLimitWait(null); pendingRetry?.() }}
        />
      )}

      {/* ── Content ── */}
      <main className="flex-1 overflow-hidden relative">
        <div key={pathname} className="animate-fade-in h-full" style={{ willChange: 'opacity' }}>
          {children}
        </div>
      </main>

      {/* ── Tab bar ── */}
      <TabBar />

      {/* ── FAB ── */}
      <FAB />

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] bg-[var(--text)] text-white text-xs rounded-full px-4 py-2 pointer-events-none select-none"
          style={{ boxShadow: '0 2px 8px rgba(15,23,42,.12)' }}>
          {toast}
        </div>
      )}

    </div>
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
