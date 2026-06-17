'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/ui/Button'
import { updateProfile } from '@/lib/firestore/profiles'
import { quotaDate } from '@/lib/utils'
import type { User } from '@/types'

interface ApiKeysPanelProps {
  profile: User
  uid: string
  onToast: (msg: string) => void
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="text-[var(--blue)] underline underline-offset-2">
      {children}
    </a>
  )
}

const GEMINI_RPD = 20

export default function ApiKeysPanel({ profile, uid, onToast }: ApiKeysPanelProps) {
  const router = useRouter()

  const geminiUsage = profile?.geminiUsage?.['gemini-2.5-flash']
  const today = quotaDate()
  const usedToday = geminiUsage?.date === today ? (geminiUsage?.count || 0) : 0
  const tokensToday = geminiUsage?.date === today ? (geminiUsage?.tokens || 0) : 0

  const [geminiKey, setGeminiKey] = useState(profile.geminiApiKey ?? '')
  const [geminiSaving, setGeminiSaving] = useState(false)
  const [geminiSaved, setGeminiSaved] = useState(false)

  const [groqKey, setGroqKey] = useState(profile.groqApiKey ?? '')
  const [groqSaving, setGroqSaving] = useState(false)
  const [groqRemoving, setGroqRemoving] = useState(false)
  const hasGroq = !!(profile.groqApiKey)

  async function saveGemini() {
    const trimmed = geminiKey.trim()
    if (!trimmed) return
    setGeminiSaving(true)
    try {
      await updateProfile(uid, { geminiApiKey: trimmed })
      sessionStorage.setItem('gemini_api_key', trimmed)
      setGeminiSaved(true)
      setTimeout(() => setGeminiSaved(false), 2500)
    } catch {
      onToast('Failed to save Gemini key')
    } finally {
      setGeminiSaving(false)
    }
  }

  async function saveGroq() {
    const trimmed = groqKey.trim()
    if (!trimmed) return
    setGroqSaving(true)
    try {
      await updateProfile(uid, { groqApiKey: trimmed })
      sessionStorage.setItem('groq_api_key', trimmed)
      onToast('Groq key saved')
      setTimeout(() => router.push('/generate'), 900)
    } catch {
      onToast('Failed to save Groq key')
      setGroqSaving(false)
    }
  }

  async function removeGroq() {
    setGroqRemoving(true)
    try {
      await updateProfile(uid, { groqApiKey: '' })
      sessionStorage.removeItem('groq_api_key')
      setGroqKey('')
      onToast('Groq key removed')
    } catch {
      onToast('Failed to remove Groq key')
    } finally {
      setGroqRemoving(false)
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Gemini */}
      <section className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4 space-y-3"
               style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text)]">Gemini API key</h3>
          <span className="text-[10px] bg-[var(--blue-lt)] text-[var(--blue)] rounded-full px-2 py-0.5 font-semibold">
            Recommended
          </span>
        </div>

        <ol className="text-xs text-[var(--text2)] space-y-1 list-decimal list-inside">
          <li>Go to <ExternalLink href="https://aistudio.google.com/app/apikey">Google AI Studio</ExternalLink></li>
          <li>Click <strong>Create API key</strong></li>
          <li>Copy and paste below</li>
        </ol>

        <div className="flex gap-2">
          <input
            type="password"
            value={geminiKey}
            onChange={e => setGeminiKey(e.target.value)}
            placeholder="AIza…"
            className="flex-1 rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg)]
                       px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors font-mono"
          />
          <Button
            variant="primary"
            onClick={saveGemini}
            loading={geminiSaving}
            disabled={!geminiKey.trim() || geminiSaved}
            size="sm"
          >
            {geminiSaved ? 'Saved ✓' : 'Save key'}
          </Button>
        </div>

        <div className="mt-3 px-3 py-2 bg-[var(--bg)] rounded-[var(--r)] border border-[var(--border)] space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text2)] whitespace-nowrap">Daily requests</span>
            <div className="flex-1 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${usedToday >= GEMINI_RPD ? 'bg-orange-400' : 'bg-[var(--blue)]'}`}
                style={{ width: `${Math.min((usedToday / GEMINI_RPD) * 100, 100)}%` }}
              />
            </div>
            <span className={`text-xs font-bold whitespace-nowrap ${usedToday >= GEMINI_RPD ? 'text-orange-500' : 'text-[var(--text)]'}`}>
              {usedToday} / {GEMINI_RPD}
            </span>
          </div>
          <div className="flex items-center justify-between">
            {usedToday >= GEMINI_RPD ? (
              <p className="text-xs text-orange-500">Limit reached — add a Groq key to continue.</p>
            ) : (
              <p className="text-xs text-[var(--text3)]">Resets daily. Add a Groq key to extend.</p>
            )}
            {tokensToday > 0 && (
              <p className="text-xs text-[var(--text3)]">{tokensToday.toLocaleString()} tokens</p>
            )}
          </div>
        </div>
      </section>

      {/* Groq */}
      <section className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4 space-y-3"
               style={{ boxShadow: 'var(--shadow-sm)' }}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text)]">Groq API key</h3>
          <span className="text-[10px] bg-[#e3f9ee] text-[#0a7d57] rounded-full px-2 py-0.5 font-semibold">
            Extends daily limits
          </span>
        </div>

        <ol className="text-xs text-[var(--text2)] space-y-1 list-decimal list-inside">
          <li>Go to <ExternalLink href="https://console.groq.com/keys">console.groq.com/keys</ExternalLink></li>
          <li>Click <strong>Create API key</strong></li>
          <li>Copy and paste below</li>
        </ol>

        <div className="flex gap-2">
          <input
            type="password"
            value={groqKey}
            onChange={e => setGroqKey(e.target.value)}
            placeholder="gsk_…"
            className="flex-1 rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg)]
                       px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                       outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                       transition-colors font-mono"
          />
          <Button
            variant="primary"
            onClick={saveGroq}
            loading={groqSaving}
            disabled={!groqKey.trim()}
            size="sm"
          >
            Save key
          </Button>
        </div>

        {hasGroq && (
          <Button
            variant="ghost"
            onClick={removeGroq}
            loading={groqRemoving}
            size="sm"
            className="text-[var(--danger)] hover:bg-red-50"
          >
            Remove key
          </Button>
        )}
      </section>
    </div>
  )
}
