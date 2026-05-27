'use client'

import { useState, useEffect } from 'react'
import Button from '@/components/ui/Button'
import type { User, Personalisation, NoteLength } from '@/types'

interface PersonalisationPanelProps {
  profile: User
  onSave: (data: Partial<User>) => Promise<void>
  onToast: (msg: string) => void
}

const DEFAULT_DOCUMENT_STYLE =
  'Write in formal Australian English. Use clear, professional clinical language. ' +
  'Avoid jargon where possible. Use passive voice for objective findings and active ' +
  'voice for clinical impressions. Spell out abbreviations on first use.'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent
                  transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:ring-offset-2
                  ${checked ? 'bg-[var(--blue)]' : 'bg-[var(--border)]'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform
                        ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

const NOTE_LENGTHS: { value: NoteLength; label: string; desc: string }[] = [
  { value: 'brief',    label: 'Brief',    desc: 'Dot points, most important only' },
  { value: 'balanced', label: 'Balanced', desc: 'Full sentences, appropriate detail' },
  { value: 'detailed', label: 'Detailed', desc: 'Comprehensive, uses quotes' },
]

export default function PersonalisationPanel({ profile, onSave, onToast }: PersonalisationPanelProps) {
  const p = profile.personalisation
  const [useClientInfo, setUseClientInfo]           = useState(p?.useClientInfo ?? true)
  const [noteLength, setNoteLength]                 = useState<NoteLength>(p?.noteLength ?? 'balanced')
  const [professionalIdentity, setProfessionalIdentity] = useState(p?.professionalIdentity ?? '')
  const [treatmentApproaches, setTreatmentApproaches]   = useState(p?.treatmentApproaches ?? '')
  const [documentStyle, setDocumentStyle]           = useState(p?.documentStyle ?? '')
  const [saving, setSaving] = useState(false)

  // A2HS state
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [showIosSheet, setShowIosSheet] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
    }
    function onPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  function isIos() {
    if (typeof navigator === 'undefined') return false
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
  }

  function handleA2HS() {
    if (isInstalled) return
    if (deferredPrompt) {
      (deferredPrompt as BeforeInstallPromptEvent).prompt()
    } else if (isIos()) {
      setShowIosSheet(true)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const next: Personalisation = {
        useClientInfo,
        noteLength,
        professionalIdentity: professionalIdentity.slice(0, 936),
        treatmentApproaches: treatmentApproaches.slice(0, 1000),
        documentStyle: documentStyle.slice(0, 1000),
      }
      await onSave({ personalisation: next })
      onToast('Personalisation saved')
    } catch {
      onToast('Failed to save personalisation')
    } finally {
      setSaving(false)
    }
  }

  function fillFromProfile() {
    const parts: string[] = []
    if (profile.displayName) parts.push(profile.displayName)
    if (profile.credentials) parts.push(profile.credentials)
    setProfessionalIdentity(parts.join(', '))
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Use patient info */}
      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--text)]">Use patient information</p>
            <p className="text-xs text-[var(--text2)] mt-0.5">
              Include patient name and reg number in generated notes
            </p>
          </div>
          <Toggle checked={useClientInfo} onChange={setUseClientInfo} />
        </div>
      </section>

      {/* Note length */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Note length</h3>
        <div className="grid grid-cols-3 gap-2">
          {NOTE_LENGTHS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setNoteLength(opt.value)}
              className={`rounded-[var(--r)] border p-3 text-left transition-colors
                ${noteLength === opt.value
                  ? 'border-[var(--blue)] bg-[var(--blue-lt)]'
                  : 'border-[var(--border)] bg-white hover:border-[var(--blue)]/40'}`}
            >
              <p className={`text-sm font-medium ${noteLength === opt.value ? 'text-[var(--blue)]' : 'text-[var(--text)]'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-[var(--text3)] mt-0.5 leading-tight">{opt.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Professional identity */}
      <section>
        <div className="flex items-end justify-between mb-1">
          <label className="block text-sm font-semibold text-[var(--text)]">Professional identity</label>
          <button onClick={fillFromProfile} className="text-xs text-[var(--blue)] hover:underline">
            Fill from profile
          </button>
        </div>
        <div className="rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] px-3 py-2 mb-2">
          <p className="text-xs text-[var(--text3)]">
            Example: &ldquo;Dr Sarah Jones, FRANZCP. Consultant Psychiatrist in private practice
            specialising in mood disorders and complex trauma.&rdquo;
          </p>
        </div>
        <textarea
          value={professionalIdentity}
          onChange={e => setProfessionalIdentity(e.target.value.slice(0, 936))}
          rows={3}
          maxLength={936}
          placeholder="Describe your role, specialty, and practice context…"
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors resize-none"
        />
        <p className="text-right text-xs text-[var(--text3)] mt-0.5">
          {professionalIdentity.length}/936
        </p>
      </section>

      {/* Treatment approaches */}
      <section>
        <div className="flex items-end justify-between mb-1">
          <label className="block text-sm font-semibold text-[var(--text)]">Treatment approaches</label>
          <button onClick={() => setTreatmentApproaches('')} className="text-xs text-[var(--text3)] hover:text-[var(--text)]">
            Clear
          </button>
        </div>
        <div className="rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] px-3 py-2 mb-2">
          <p className="text-xs text-[var(--text3)]">
            Example: &ldquo;I use CBT, DBT skills training, and psychodynamic approaches.
            I prioritise trauma-informed care and psychoeducation.&rdquo;
          </p>
        </div>
        <textarea
          value={treatmentApproaches}
          onChange={e => setTreatmentApproaches(e.target.value.slice(0, 1000))}
          rows={3}
          maxLength={1000}
          placeholder="List your therapeutic modalities and clinical approaches…"
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors resize-none"
        />
        <p className="text-right text-xs text-[var(--text3)] mt-0.5">
          {treatmentApproaches.length}/1000
        </p>
      </section>

      {/* Document style */}
      <section>
        <div className="flex items-end justify-between mb-1">
          <label className="block text-sm font-semibold text-[var(--text)]">Document style</label>
          <button
            onClick={() => setDocumentStyle(DEFAULT_DOCUMENT_STYLE)}
            className="text-xs text-[var(--blue)] hover:underline"
          >
            Reset to default
          </button>
        </div>
        <div className="rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] px-3 py-2 mb-2">
          <p className="text-xs text-[var(--text3)]">
            Example: &ldquo;Write in formal Australian English. Use clear, professional clinical
            language. Avoid jargon where possible.&rdquo;
          </p>
        </div>
        <textarea
          value={documentStyle}
          onChange={e => setDocumentStyle(e.target.value.slice(0, 1000))}
          rows={3}
          maxLength={1000}
          placeholder="Describe your preferred writing style and language conventions…"
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors resize-none"
        />
        <p className="text-right text-xs text-[var(--text3)] mt-0.5">
          {documentStyle.length}/1000
        </p>
      </section>

      {/* Add to Home Screen */}
      <section className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4"
               style={{ boxShadow: 'var(--shadow-sm)' }}>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Add to Home Screen</h3>
        <p className="text-xs text-[var(--text2)] mb-3">
          Install LushNote as an app for faster access.
        </p>
        {isInstalled ? (
          <p className="text-xs text-[var(--text3)]">LushNote is already installed.</p>
        ) : (
          <Button variant="secondary" size="sm" onClick={handleA2HS}>
            Add to Home Screen
          </Button>
        )}
      </section>

      <Button variant="primary" onClick={handleSave} loading={saving}>
        Save personalisation
      </Button>

      {/* iOS Add to Home Screen sheet */}
      {showIosSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowIosSheet(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-2xl p-5 space-y-3"
               style={{ boxShadow: 'var(--shadow-lg)' }}>
            <h3 className="text-base font-semibold text-[var(--text)]">Add LushNote to Home Screen</h3>
            <ol className="text-sm text-[var(--text2)] space-y-2 list-decimal list-inside">
              <li>Tap the <strong>Share</strong> button at the bottom of Safari</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> to confirm</li>
            </ol>
            <Button variant="primary" onClick={() => setShowIosSheet(false)} className="w-full">
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Extend Window for beforeinstallprompt
interface BeforeInstallPromptEvent extends Event {
  prompt(): void
}
