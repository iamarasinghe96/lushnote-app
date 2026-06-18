'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

export default function Page() {
  const { user, profile, loading, signInWithGoogle } = useAuth()
  const router = useRouter()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (user && profile?.onboardingComplete) {
      router.replace('/generate')
    } else if (user && !profile?.onboardingComplete) {
      router.replace('/onboarding')
    }
  }, [loading, user, profile, router])

  if (loading || user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <Spinner />
      </div>
    )
  }

  async function handleSignIn() {
    try {
      setSigning(true)
      setError('')
      await signInWithGoogle()
    } catch {
      setError('Sign-in failed. Please try again.')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div className="min-h-screen text-[var(--text)] relative">
      {/* Fixed full-viewport background so glass cards scroll over it */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: -1,
          background: [
            'radial-gradient(ellipse 90% 55% at 50% 0%,   rgba(90,214,167,0.85) 0%, transparent 58%)',
            'radial-gradient(ellipse 65% 40% at 92% 18%,  rgba(37,99,235,0.60)  0%, transparent 52%)',
            'radial-gradient(ellipse 70% 38% at 6%  50%,  rgba(90,214,167,0.55) 0%, transparent 52%)',
            'radial-gradient(ellipse 65% 38% at 90% 70%,  rgba(37,99,235,0.55)  0%, transparent 52%)',
            'radial-gradient(ellipse 60% 30% at 18% 90%,  rgba(90,214,167,0.50) 0%, transparent 48%)',
            '#f0f7ff',
          ].join(', '),
        }}
      />

      {/* ── Nav ── */}
      <nav
        className="fixed left-4 right-4 z-40 flex items-center justify-between px-5 sm:px-8"
        style={{
          top: 'calc(env(safe-area-inset-top) + 12px)',
          height: 52,
          borderRadius: 20,
          backdropFilter: 'blur(20px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
          background: 'rgba(255,255,255,0.18)',
          border: '1px solid rgba(255,255,255,0.40)',
          boxShadow: '0 4px 24px rgba(15,23,42,.10), 0 1px 3px rgba(15,23,42,.06)',
        }}
      >
        <div className="flex items-center gap-2 select-none">
          <img src="/icon.svg" alt="" width={28} height={28} aria-hidden />
          <span className="font-semibold text-[var(--text)] text-[15px]">LushNote</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSignIn}
            disabled={signing}
            className="px-3 py-1.5 text-sm font-medium text-[var(--text2)] hover:text-[var(--text)]
                       border border-white/70 rounded-[var(--r)] hover:border-white
                       motion-safe:transition-colors disabled:opacity-50"
          >
            Sign In
          </button>
          <button
            onClick={handleSignIn}
            disabled={signing}
            className="px-4 py-1.5 text-sm font-medium text-white bg-[#10b981] rounded-[var(--r)]
                       hover:bg-[#059669] motion-safe:transition-colors motion-safe:active:scale-[0.97]
                       motion-safe:transition-transform disabled:opacity-50"
          >
            {signing ? 'Signing in…' : 'Sign Up Free'}
          </button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section
        className="relative flex flex-col items-center justify-center min-h-screen text-center px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 80px)' }}
      >
        <div className="max-w-2xl mx-auto space-y-6">
          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold
                           bg-[var(--blue-lt)] text-[var(--blue)]">
            Built to save one more life
          </span>

          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text)] leading-tight">
            Clinical notes in seconds
          </h1>

          <p className="text-lg text-[var(--text2)] leading-relaxed">
            AI-powered notes and referral letters for doctors.<br className="hidden sm:block" />
            Record, transcribe, structure, all in one workflow.
          </p>

          {error && (
            <p className="text-sm text-[var(--danger)]">{error}</p>
          )}

          <div className="flex items-center justify-center">
            <button
              onClick={handleSignIn}
              disabled={signing}
              className="w-full sm:w-auto px-6 py-3 rounded-[var(--r)] bg-[#10b981] text-white
                         font-semibold text-sm hover:bg-[#059669]
                         motion-safe:transition-colors motion-safe:active:scale-[0.97]
                         motion-safe:duration-100 disabled:opacity-50"
            >
              {signing ? 'Signing in…' : 'Get started free'}
            </button>
          </div>

          <div className="flex justify-center pt-8">
            <img src="/LushNote_Logo.svg" alt="LushNote" className="w-28 h-28" />
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-[var(--text)] mb-12">
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-8">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.title} className="flex flex-col items-center text-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--blue-lt)] text-[var(--blue)]
                                flex items-center justify-center text-sm font-bold shrink-0">
                  {i + 1}
                </div>
                <p className="font-semibold text-[var(--text)] text-sm">{step.title}</p>
                <p className="text-xs text-[var(--text2)] leading-relaxed">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features grid ── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-[var(--text)] mb-12">
            Everything you need
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="rounded-[var(--r-lg)] p-4 backdrop-blur-md"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(28px) saturate(1.6)',
                  WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
                  boxShadow: '0 2px 16px rgba(15,23,42,.06), 0 0 0 1px rgba(255,255,255,0.65)',
                }}
              >
                <div className="mb-2 text-[var(--blue)]">{f.icon}</div>
                <p className="text-sm font-semibold text-[var(--text)] mb-1">{f.title}</p>
                <p className="text-xs text-[var(--text2)] leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Five modes ── */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-[var(--text)] mb-12">
            Five ways to create a note
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODES.map(m => (
              <div
                key={m.title}
                className="rounded-[var(--r-lg)] border border-[var(--border)] p-4"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(28px) saturate(1.6)',
                  WebkitBackdropFilter: 'blur(28px) saturate(1.6)',
                  boxShadow: '0 2px 16px rgba(15,23,42,.06), 0 0 0 1px rgba(255,255,255,0.65)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--blue-lt)] flex items-center justify-center shrink-0">
                    {m.icon}
                  </div>
                  <p className="text-sm font-semibold text-[var(--text)]">{m.title}</p>
                  {m.soon && (
                    <span className="ml-auto text-[10px] font-medium text-[var(--text3)] bg-[var(--bg)] px-2 py-0.5 rounded-full">
                      soon
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text2)] leading-relaxed">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="py-20 px-4">
        <div
          className="max-w-xl mx-auto text-center space-y-4 rounded-[var(--r-lg)] py-14 px-6"
          style={{
            background: 'rgba(29,78,216,0.18)',
            backdropFilter: 'blur(32px) saturate(1.8)',
            WebkitBackdropFilter: 'blur(32px) saturate(1.8)',
            border: '1px solid rgba(29,78,216,0.30)',
            boxShadow: '0 8px 32px rgba(29,78,216,0.12), inset 0 1px 0 rgba(255,255,255,0.25)',
          }}
        >
          <h2 className="text-3xl font-bold text-[#1d4ed8]">Document smarter.</h2>
          <p className="text-[var(--text2)] text-lg">Save one more life.</p>
          <button
            onClick={handleSignIn}
            disabled={signing}
            className="mt-2 px-8 py-3 rounded-[var(--r)] bg-[var(--blue)] text-white font-semibold
                       text-sm hover:bg-[var(--blue-dk)]
                       motion-safe:transition-colors motion-safe:active:scale-[0.97]
                       motion-safe:duration-100 disabled:opacity-50"
          >
            {signing ? 'Signing in…' : 'Start for free'}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border)] py-6 px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-[var(--text3)]">
            © 2025 LushNote. Built to save one more life.
          </p>
          <div className="flex items-center gap-4 text-xs text-[var(--text3)]">
            <a href="#" className="hover:text-[var(--text)] motion-safe:transition-colors">Privacy</a>
            <a href="#" className="hover:text-[var(--text)] motion-safe:transition-colors">Terms</a>
            <a
              href="mailto:iamarasinghe96@gmail.com"
              className="hover:text-[var(--text)] motion-safe:transition-colors"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>

    </div>
  )
}

const HOW_IT_WORKS = [
  {
    title: 'Record',
    description: 'Record a session, dictate a note, or paste a transcript.',
  },
  {
    title: 'Transcribe',
    description: 'Audio is transcribed instantly using Gemini or Groq.',
  },
  {
    title: 'Generate',
    description: 'Choose a template - AI structures a complete clinical note.',
  },
  {
    title: 'Export',
    description: 'Download as PDF, copy to clipboard, or send by email.',
  },
]

const FEATURES: { icon: React.ReactNode; title: string; description: string }[] = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.75" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
    title: '116 clinical templates',
    description: 'Progress notes, assessments, therapy notes, and risk & safety across all specialties.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.75" aria-hidden>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    ),
    title: 'Privacy-first',
    description: 'Audio is never stored. Transcripts are redacted before leaving your device.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.75" aria-hidden>
        <rect x="2" y="7" width="20" height="14" rx="2"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>
    ),
    title: 'Multiple workplaces',
    description: 'Switch between clinics with one tap. Each with its own colour theme.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.75" aria-hidden>
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4l3 3"/>
      </svg>
    ),
    title: 'Gemini + Groq AI',
    description: 'Bring your own free API key. Gemini 2.5 Flash with Groq as fallback.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.75" aria-hidden>
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
    ),
    title: 'Custom templates',
    description: 'Build your own AI instructions, tailored to your exact documentation style.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="1.75" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
        <line x1="12" y1="18" x2="12" y2="12"/>
        <polyline points="9,15 12,18 15,15"/>
      </svg>
    ),
    title: 'PDF & email export',
    description: 'Download A4 PDFs or send to colleagues with a pre-written cover letter.',
  },
]

const MODES = [
  {
    title: 'Paste Transcript',
    description: 'Paste a transcript and LushNote structures it into a complete clinical note.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <rect x="8" y="2" width="8" height="4" rx="1"/>
      </svg>
    ),
    soon: false,
  },
  {
    title: 'Dictate Note',
    description: 'Record yourself speaking and get an AI-structured note from your dictation.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    ),
    soon: false,
  },
  {
    title: 'Record Session',
    description: 'Record in-person or telehealth sessions directly in the browser.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    ),
    soon: false,
  },
  {
    title: 'Create Document',
    description: 'Paste or upload a text document and generate a structured note from it.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14,2 14,8 20,8"/>
      </svg>
    ),
    soon: false,
  },
  {
    title: 'Upload Recording',
    description: 'Upload an audio file from any device for transcription and note generation.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" aria-hidden>
        <polyline points="16,16 12,12 8,16"/>
        <line x1="12" y1="12" x2="12" y2="21"/>
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
      </svg>
    ),
    soon: true,
  },
]

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin text-[#10b981]"
      aria-hidden
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"
      />
    </svg>
  )
}
