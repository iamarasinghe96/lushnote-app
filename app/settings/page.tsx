'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import { updateProfile } from '@/lib/firestore/profiles'
import { applyWorkspaceTheme } from '@/lib/utils'
import ProfilePanel from '@/components/settings/ProfilePanel'
import WorkplacesPanel from '@/components/settings/WorkplacesPanel'
import TemplatesPanel from '@/components/settings/TemplatesPanel'
import TranscriptsPanel from '@/components/settings/TranscriptsPanel'
import ApiKeysPanel from '@/components/settings/ApiKeysPanel'
import PersonalisationPanel from '@/components/settings/PersonalisationPanel'
import SubscriptionPanel from '@/components/settings/SubscriptionPanel'
import type { User, Workplace } from '@/types'

type TabKey = 'profile' | 'workplaces' | 'templates' | 'transcripts' | 'api-keys' | 'personalisation' | 'subscription'

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  {
    key: 'profile',
    label: 'Profile',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
  {
    key: 'workplaces',
    label: 'Workplaces',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
  },
  {
    key: 'templates',
    label: 'Templates',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10,9 9,9 8,9"/>
      </svg>
    ),
  },
  {
    key: 'transcripts',
    label: 'Transcripts',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    ),
  },
  {
    key: 'api-keys',
    label: 'API Keys',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
      </svg>
    ),
  },
  {
    key: 'personalisation',
    label: 'Personalisation',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
  {
    key: 'subscription',
    label: 'Subscription',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    ),
  },
]

function useToast() {
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null)

  const show = useCallback((message: string) => {
    const key = Date.now()
    setToast({ message, key })
    setTimeout(() => setToast(t => (t?.key === key ? null : t)), 2800)
  }, [])

  return { toast, show }
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}

function SettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, loading, refreshProfile } = useAuth()
  const { toast, show: showToast } = useToast()

  const [activeTab, setActiveTab] = useState<TabKey>('profile')

  useEffect(() => {
    const param = searchParams.get('tab') as TabKey | null
    if (param && TABS.some(t => t.key === param)) {
      setActiveTab(param)
    }
  }, [searchParams])

  useEffect(() => {
    if (!loading && !user) router.replace('/')
  }, [loading, user, router])

  useEffect(() => {
    if (!profile) return
    const activeWp = profile.workplaces?.find(w => w.id === profile.activeWorkplaceId)
    applyWorkspaceTheme(activeWp?.themeIndex ?? 1, activeWp?.themeColor)
  }, [profile])

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[#10b981]" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
        </svg>
      </div>
    )
  }

  if (!user || !profile) return null

  async function handleSave(data: Partial<User>) {
    if (!user) return
    await updateProfile(user.uid, data)
    await refreshProfile()
  }

  async function handleSaveWorkplaces(workplaces: Workplace[], activeId: string) {
    await handleSave({ workplaces, activeWorkplaceId: activeId })
  }

  function renderPanel() {
    switch (activeTab) {
      case 'profile':
        return (
          <ProfilePanel
            profile={profile!}
            uid={user!.uid}
            onSave={handleSave}
            onToast={showToast}
          />
        )
      case 'workplaces':
        return (
          <WorkplacesPanel
            profile={profile!}
            onSave={handleSaveWorkplaces}
            onToast={showToast}
          />
        )
      case 'templates':
        return (
          <TemplatesPanel
            profile={profile!}
            onSave={handleSave}
            onToast={showToast}
          />
        )
      case 'transcripts':
        return (
          <TranscriptsPanel
            profile={profile!}
            onSave={handleSave}
            onToast={showToast}
          />
        )
      case 'api-keys':
        return (
          <ApiKeysPanel
            profile={profile!}
            uid={user!.uid}
            onToast={showToast}
          />
        )
      case 'personalisation':
        return (
          <PersonalisationPanel
            profile={profile!}
            onSave={handleSave}
            onToast={showToast}
          />
        )
      case 'subscription':
        return <SubscriptionPanel profile={profile!} />
    }
  }

  const activeTabData = TABS.find(t => t.key === activeTab)

  return (
    <div className="flex flex-col bg-[var(--bg)]" style={{ height: '100dvh' }}>

      {/* Header — padded for iOS status bar */}
      <header
        className="relative z-30 flex items-center gap-3 px-4 shrink-0
                   backdrop-blur-lg bg-white/85 border-b border-white/50"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          height: 'calc(52px + env(safe-area-inset-top))',
          boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
        }}
      >
        <Link
          href="/generate"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text2)]
                     hover:bg-[var(--bg)] transition-colors"
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <polyline points="15,18 9,12 15,6"/>
          </svg>
        </Link>
        <span className="font-semibold text-[var(--text)] text-[15px]">Settings</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - desktop */}
        <nav className="hidden sm:flex flex-col w-52 shrink-0 border-r border-[var(--border)] overflow-y-auto py-2">
          {TABS.map(tab => {
            const active = tab.key === activeTab
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors mx-2 rounded-lg
                  ${active
                    ? 'bg-[var(--blue-lt)] text-[var(--blue)] font-medium'
                    : 'text-[var(--text2)] hover:bg-[var(--bg)] hover:text-[var(--text)]'}`}
              >
                <span className={active ? 'text-[var(--blue)]' : 'text-[var(--text3)]'}>
                  {tab.icon}
                </span>
                {tab.label}
              </button>
            )
          })}
        </nav>

        {/* Mobile nav - horizontal scroll */}
        <div className="sm:hidden absolute left-0 right-0 z-20 bg-white border-b border-[var(--border)] overflow-x-auto scrollbar-none" style={{ top: 'calc(52px + env(safe-area-inset-top))' }}>
          <div className="flex gap-1 px-3 py-2 min-w-max">
            {TABS.map(tab => {
              const active = tab.key === activeTab
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors
                    ${active
                      ? 'bg-[var(--blue-lt)] text-[var(--blue)] font-medium'
                      : 'text-[var(--text2)] hover:bg-[var(--bg)]'}`}
                >
                  <span className={active ? 'text-[var(--blue)]' : 'text-[var(--text3)]'}>
                    {tab.icon}
                  </span>
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Panel content */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 py-5 sm:py-6 pb-20 sm:pb-8 mt-[48px] sm:mt-0">
            <h2 className="text-base font-semibold text-[var(--text)] mb-5">
              {activeTabData?.label}
            </h2>
            {renderPanel()}
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div
          key={toast.key}
          className="fixed bottom-6 right-4 z-50 px-4 py-2 bg-[#0f172a] text-white text-sm
                     rounded-lg animate-slide-up pointer-events-none"
          style={{ willChange: 'transform, opacity' }}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
