'use client'

import { useState, useEffect } from 'react'
import Button from '@/components/ui/Button'
import type { User, Personalisation, NoteLength } from '@/types'

// The "Add to Home Screen" / install option is intentionally hidden from the UI
// (doctors shouldn't install the standalone PWA — the browser experience is the
// supported one). The code is kept intact; flip this to re-enable it.
const SHOW_ADD_TO_HOME = false

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
  const [noteLength, setNoteLength]                 = useState<NoteLength>(p?.noteLength ?? 'balanced')
  const [professionalIdentity, setProfessionalIdentity] = useState(p?.professionalIdentity ?? '')
  const [treatmentApproaches, setTreatmentApproaches]   = useState(p?.treatmentApproaches ?? '')
  const [documentStyle, setDocumentStyle]           = useState(p?.documentStyle ?? '')
  const [saving, setSaving] = useState(false)

  // A2HS state
  const [installState, setInstallState] = useState<'ios' | 'installable' | 'desktop' | 'installed' | 'unsupported'>('unsupported')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosSheetOpen, setIosSheetOpen] = useState(false)
  const [desktopSheetOpen, setDesktopSheetOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    const isIos = /iPhone|iPad|iPod/.test(ua)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    const isDesktop = !isIos && !/Android/i.test(ua)

    if (isStandalone) { setInstallState('installed'); return }
    if (isIos) { setInstallState('ios'); return }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setInstallState('installable')
    }
    window.addEventListener('beforeinstallprompt', handler)

    if (isDesktop) setInstallState('desktop')

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function handleInstall() {
    if (installState === 'ios') {
      setIosSheetOpen(true)
    } else if (installState === 'installable' && deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') setInstallState('installed')
    } else if (installState === 'desktop') {
      setDesktopSheetOpen(true)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const next: Personalisation = {
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

      <Button variant="primary" onClick={handleSave} loading={saving}>
        Save personalisation
      </Button>

      {/* Add to Home Screen — hidden from the UI (see SHOW_ADD_TO_HOME); code kept. */}
      {SHOW_ADD_TO_HOME && (
      <div className="mt-6 pt-6 border-t border-[var(--border)]">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Add to Home Screen</h3>
        <p className="text-xs text-[var(--text3)] mb-3">
          Install LushNote on your device for a faster, app-like experience.
        </p>
        {installState === 'installed' ? (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>LushNote is already installed</span>
          </div>
        ) : installState === 'unsupported' ? (
          <p className="text-xs text-[var(--text3)]">Open LushNote in Chrome or Safari to install.</p>
        ) : (
          <button
            onClick={handleInstall}
            className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)]
                       motion-safe:transition-transform motion-safe:active:scale-[0.97]"
          >
            {installState === 'desktop' ? 'Install App' : 'Add to Home Screen'}
          </button>
        )}
      </div>
      )}

      {/* Desktop install sheet */}
      {desktopSheetOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
          <div className="bg-white w-full rounded-t-[20px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[var(--text)]">Install LushNote</h3>
              <button
                onClick={() => setDesktopSheetOpen(false)}
                className="text-[var(--text3)] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg)]"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <ol className="space-y-4 text-sm text-[var(--text2)]">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--blue)] text-white text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
                <span>In Chrome, click the <strong>install icon</strong> (⊕) in the address bar - or click the three-dot menu (⋮) and select <strong>&ldquo;Install LushNote&rdquo;</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--blue)] text-white text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
                <span>In Edge, click the three-dot menu (···) → <strong>Apps</strong> → <strong>&ldquo;Install this site as an app&rdquo;</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--blue)] text-white text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
                <span>Click <strong>&ldquo;Install&rdquo;</strong> in the popup - LushNote will open as a standalone window</span>
              </li>
            </ol>
            <button
              onClick={() => setDesktopSheetOpen(false)}
              className="w-full mt-6 bg-[var(--blue)] text-white font-medium py-3 rounded-[var(--r-lg)] text-sm
                         motion-safe:transition-transform motion-safe:active:scale-[0.97]"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* iOS step sheet */}
      {iosSheetOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
          <div className="bg-white w-full rounded-t-[20px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-[var(--text)]">Add to Home Screen</h3>
              <button
                onClick={() => setIosSheetOpen(false)}
                className="text-[var(--text3)] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg)]"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <ol className="space-y-4 text-sm text-[var(--text2)]">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--blue)] text-white text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
                <span>Tap the <strong>Share</strong> button at the bottom of your browser (box with arrow pointing up)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--blue)] text-white text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
                <span>Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-[var(--blue)] text-white text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
                <span>Tap <strong>&ldquo;Add&rdquo;</strong> in the top right corner</span>
              </li>
            </ol>
            <button
              onClick={() => setIosSheetOpen(false)}
              className="w-full mt-6 bg-[var(--blue)] text-white font-medium py-3 rounded-[var(--r-lg)] text-sm
                         motion-safe:transition-transform motion-safe:active:scale-[0.97]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): void
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
