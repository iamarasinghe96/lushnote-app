'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { createProfile, updateProfile } from '@/lib/firestore/profiles'
import { detectIdPattern } from '@/lib/utils'
import type { WorkplaceType, Workplace } from '@/types'

const WORKPLACE_TYPES: WorkplaceType[] = [
  'Private Practice',
  'Hospital',
  'Community Mental Health',
  'Telehealth',
  'Other',
]

const EMAIL_PRESETS: readonly string[] = [
  'I reviewed this patient today and wanted to share the following progress note.',
  "Please find enclosed a progress note from today's session.",
  'I am writing to update you on the progress of our mutual patient.',
]

type Step = 1 | 2 | 3 | 4 | 5

interface PatternPreview {
  regex: string
  template: string
  description: string
}

export default function OnboardingPage() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const router = useRouter()

  const [step, setStep] = useState<Step>(1)
  const [displayName, setDisplayName] = useState('')
  const [credentials, setCredentials] = useState('')
  const [workplaceName, setWorkplaceName] = useState('')
  const [workplaceType, setWorkplaceType] = useState<WorkplaceType>('Private Practice')
  const [regSystem, setRegSystem] = useState<'none' | 'existing'>('none')
  const [regFormat, setRegFormat] = useState('')
  const [patternPreview, setPatternPreview] = useState<PatternPreview | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<0 | 1 | 2 | 3>(0)
  const [emailPretext, setEmailPretext] = useState<string>(EMAIL_PRESETS[0])
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/')
      return
    }
    if (profile?.onboardingComplete) {
      router.replace('/generate')
    }
  }, [loading, user, profile, router])

  if (loading || !user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <Spinner />
      </div>
    )
  }

  function handleRegFormatChange(value: string) {
    setRegFormat(value)
    setPatternPreview(detectIdPattern(value))
  }

  function selectPreset(index: 0 | 1 | 2 | 3) {
    setSelectedPreset(index)
    if (index < 3) {
      setEmailPretext(EMAIL_PRESETS[index] ?? '')
    } else {
      setEmailPretext('')
    }
  }

  function canAdvance(): boolean {
    if (step === 1) return displayName.trim().length > 0
    if (step === 2) return workplaceName.trim().length > 0
    return true
  }

  function nextStep() {
    if (step < 5) setStep((s) => (s + 1) as Step)
  }

  function prevStep() {
    if (step > 1) setStep((s) => (s - 1) as Step)
  }

  async function handleComplete() {
    if (!user) return
    setSubmitting(true)
    setError('')
    try {
      const workplaceId = crypto.randomUUID()
      const workplace: Workplace = {
        id: workplaceId,
        name: workplaceName.trim(),
        type: workplaceType,
        regSystem,
        ...(regSystem === 'existing' && patternPreview
          ? {
              regFormat,
              regPattern: patternPreview.regex,
              regTemplate: patternPreview.template,
            }
          : {}),
        themeIndex: 0,
      }

      await createProfile(user.uid, {
        uid: user.uid,
        email: user.email ?? '',
        displayName: displayName.trim(),
        credentials: credentials.trim(),
        workplaces: [workplace],
        activeWorkplaceId: workplaceId,
        emailPretext,
        onboardingComplete: true,
        notesMigrated: false,
        favoriteTemplateIds: [],
        customTemplates: [],
        status: 'active',
        tier: 'free',
      })

      if (geminiApiKey.trim()) {
        await updateProfile(user.uid, { geminiApiKey: geminiApiKey.trim() })
        sessionStorage.setItem('gemini_api_key', geminiApiKey.trim())
      }

      await refreshProfile()
      router.push('/generate')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center gap-2 mb-8">
          <img src="/icon.svg" alt="LushNote" width={32} height={32} />
          <span className="font-semibold text-[#0f172a]">LushNote</span>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-2 mb-8">
          {([1, 2, 3, 4, 5] as const).map((s) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all ${
                s === step
                  ? 'w-6 bg-[#10b981]'
                  : s < step
                  ? 'w-2 bg-[#10b981] opacity-50'
                  : 'w-2 bg-[#e2e8f0]'
              }`}
            />
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-[#e2e8f0]">
          {step === 1 && (
            <Step1
              displayName={displayName}
              credentials={credentials}
              onDisplayName={setDisplayName}
              onCredentials={setCredentials}
            />
          )}
          {step === 2 && (
            <Step2
              workplaceName={workplaceName}
              workplaceType={workplaceType}
              regSystem={regSystem}
              regFormat={regFormat}
              patternPreview={patternPreview}
              onWorkplaceName={setWorkplaceName}
              onWorkplaceType={setWorkplaceType}
              onRegSystem={setRegSystem}
              onRegFormat={handleRegFormatChange}
            />
          )}
          {step === 3 && (
            <Step3
              selectedPreset={selectedPreset}
              emailPretext={emailPretext}
              onSelectPreset={selectPreset}
              onEmailPretext={setEmailPretext}
            />
          )}
          {step === 4 && (
            <Step4
              geminiApiKey={geminiApiKey}
              onGeminiApiKey={setGeminiApiKey}
              onSkip={nextStep}
            />
          )}
          {step === 5 && (
            <Step5
              displayName={displayName}
              credentials={credentials}
              workplaceName={workplaceName}
              error={error}
            />
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#e2e8f0]">
            <button
              onClick={prevStep}
              disabled={step === 1}
              className="text-sm text-[#475569] disabled:opacity-0"
            >
              Back
            </button>
            {step < 5 ? (
              <button
                onClick={nextStep}
                disabled={!canAdvance()}
                className="rounded-xl bg-[#10b981] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 active:scale-95 transition"
              >
                {step === 4 ? 'Next' : 'Continue'}
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={submitting}
                className="rounded-xl bg-[#10b981] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 active:scale-95 transition flex items-center gap-2"
              >
                {submitting && <Spinner size={16} />}
                Get started
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

/* ── Step components ────────────────────────────────── */

function Step1({
  displayName,
  credentials,
  onDisplayName,
  onCredentials,
}: {
  displayName: string
  credentials: string
  onDisplayName: (v: string) => void
  onCredentials: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#0f172a]">Who are you?</h2>
      <div>
        <label className="block text-sm font-medium text-[#0f172a] mb-1">
          Full name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => onDisplayName(e.target.value)}
          placeholder="Dr Jane Smith"
          className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#0f172a] mb-1">Credentials</label>
        <input
          type="text"
          value={credentials}
          onChange={(e) => onCredentials(e.target.value)}
          placeholder="FRANZCP, MBChB"
          className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981]"
        />
      </div>
    </div>
  )
}

function Step2({
  workplaceName,
  workplaceType,
  regSystem,
  regFormat,
  patternPreview,
  onWorkplaceName,
  onWorkplaceType,
  onRegSystem,
  onRegFormat,
}: {
  workplaceName: string
  workplaceType: WorkplaceType
  regSystem: 'none' | 'existing'
  regFormat: string
  patternPreview: PatternPreview | null
  onWorkplaceName: (v: string) => void
  onWorkplaceType: (v: WorkplaceType) => void
  onRegSystem: (v: 'none' | 'existing') => void
  onRegFormat: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#0f172a]">Your workplace</h2>
      <div>
        <label className="block text-sm font-medium text-[#0f172a] mb-1">
          Workplace name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={workplaceName}
          onChange={(e) => onWorkplaceName(e.target.value)}
          placeholder="City Psychiatry Clinic"
          className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#0f172a] mb-1">Setting</label>
        <select
          value={workplaceType}
          onChange={(e) => onWorkplaceType(e.target.value as WorkplaceType)}
          className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] bg-white"
        >
          {WORKPLACE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-[#0f172a] mb-1">Patient registration</label>
        <div className="flex gap-3">
          {(['none', 'existing'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onRegSystem(v)}
              className={`flex-1 rounded-xl border py-2 text-sm font-medium transition ${
                regSystem === v
                  ? 'border-[#10b981] bg-[#f0fdf4] text-[#10b981]'
                  : 'border-[#e2e8f0] text-[#475569]'
              }`}
            >
              {v === 'none' ? 'No system' : 'Use existing'}
            </button>
          ))}
        </div>
      </div>
      {regSystem === 'existing' && (
        <div>
          <label className="block text-sm font-medium text-[#0f172a] mb-1">
            Example patient ID
          </label>
          <input
            type="text"
            value={regFormat}
            onChange={(e) => onRegFormat(e.target.value)}
            placeholder="e.g. 12345678AB"
            className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981]"
          />
          {patternPreview && (
            <div className="mt-2 rounded-lg bg-[#f0fdf4] px-3 py-2 text-xs text-[#059669]">
              Template: <span className="font-mono font-semibold">{patternPreview.template}</span>
              {' · '}{patternPreview.description}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Step3({
  selectedPreset,
  emailPretext,
  onSelectPreset,
  onEmailPretext,
}: {
  selectedPreset: 0 | 1 | 2 | 3
  emailPretext: string
  onSelectPreset: (v: 0 | 1 | 2 | 3) => void
  onEmailPretext: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#0f172a]">Email template</h2>
      <p className="text-sm text-[#475569]">Opening line when emailing a note to a colleague.</p>
      <div className="space-y-2">
        {EMAIL_PRESETS.map((text, i) => (
          <button
            key={i}
            onClick={() => onSelectPreset(i as 0 | 1 | 2)}
            className={`w-full rounded-xl border-2 p-3 text-left text-sm transition ${
              selectedPreset === i
                ? 'border-[#10b981] bg-[#f0fdf4] text-[#0f172a]'
                : 'border-[#e2e8f0] text-[#475569]'
            }`}
            style={selectedPreset === i ? { boxShadow: '0 0 0 3px rgba(16,185,129,0.15)' } : undefined}
          >
            {text}
          </button>
        ))}
        <button
          onClick={() => onSelectPreset(3)}
          className={`w-full rounded-xl border-2 p-3 text-left text-sm font-medium transition ${
            selectedPreset === 3
              ? 'border-[#10b981] bg-[#f0fdf4] text-[#10b981]'
              : 'border-[#e2e8f0] text-[#475569]'
          }`}
          style={selectedPreset === 3 ? { boxShadow: '0 0 0 3px rgba(16,185,129,0.15)' } : undefined}
        >
          Custom
        </button>
      </div>
      <textarea
        value={emailPretext}
        onChange={(e) => onEmailPretext(e.target.value)}
        rows={3}
        placeholder="Write your own opening line…"
        className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981] resize-none"
      />
    </div>
  )
}

function Step4({
  geminiApiKey,
  onGeminiApiKey,
  onSkip,
}: {
  geminiApiKey: string
  onGeminiApiKey: (v: string) => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#0f172a]">Gemini API key</h2>
      <p className="text-sm text-[#475569]">
        LushNote uses Google Gemini to generate notes. It&apos;s free - you just need a Google account.
      </p>

      {/* Step-by-step instructions */}
      <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-4 space-y-2">
        <p className="text-xs font-semibold text-[#0f172a] mb-3">How to get your free API key:</p>
        {[
          <>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-[#2563eb] underline font-medium">aistudio.google.com</a> and sign in with your Google account</>,
          <>Click <span className="font-semibold text-[#0f172a]">&quot;Create API key&quot;</span> in the top right corner</>,
          <>Create a new project - name it <span className="font-semibold text-[#0f172a]">LushNote</span> (or anything you like)</>,
          <>Select that project and click <span className="font-semibold text-[#0f172a]">Create</span></>,
          <>Copy the key that appears and paste it below</>,
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="mt-0.5 w-4 h-4 rounded-full bg-[#10b981] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <p className="text-xs text-[#475569] leading-relaxed">{step}</p>
          </div>
        ))}
      </div>

      <div>
        <label className="block text-sm font-medium text-[#0f172a] mb-1">Paste your API key</label>
        <input
          type="password"
          value={geminiApiKey}
          onChange={(e) => onGeminiApiKey(e.target.value)}
          placeholder="AIza…"
          className="w-full rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-sm text-[#0f172a] outline-none focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981] font-mono"
        />
      </div>

      <button
        onClick={onSkip}
        className="block w-full text-center text-sm text-[#94a3b8] mt-1"
      >
        Skip for now
      </button>
    </div>
  )
}

function Step5({
  displayName,
  credentials,
  workplaceName,
  error,
}: {
  displayName: string
  credentials: string
  workplaceName: string
  error: string
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[#0f172a]">You&apos;re all set</h2>
      <div className="rounded-xl bg-[#f8fafc] border border-[#e2e8f0] p-4 space-y-2 text-sm">
        <div className="flex gap-2">
          <span className="text-[#94a3b8] w-24 flex-none">Name</span>
          <span className="text-[#0f172a] font-medium">{displayName}</span>
        </div>
        {credentials && (
          <div className="flex gap-2">
            <span className="text-[#94a3b8] w-24 flex-none">Credentials</span>
            <span className="text-[#0f172a]">{credentials}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-[#94a3b8] w-24 flex-none">Workplace</span>
          <span className="text-[#0f172a]">{workplaceName}</span>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

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
