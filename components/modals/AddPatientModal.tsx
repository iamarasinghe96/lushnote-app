'use client'

import { useState, useEffect, useRef } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import { useSegmentedRecorder } from '@/hooks/useSegmentedRecorder'
import { useAuth } from '@/hooks/useAuth'
import { savePatientProfile } from '@/lib/firestore/patients'
import { deleteTranscriptDraft } from '@/lib/firestore/transcriptDrafts'
import { getGroqKey, openSettings, TRACKED_CLINICAL_FIELDS, capitalizeName } from '@/lib/utils'
import type { PatientProfile } from '@/types'

interface AddPatientModalProps {
  open: boolean
  onClose: () => void
  onSaved: (profile: PatientProfile) => void
}

type Phase = 'details' | 'method' | 'idle' | 'recording' | 'processing' | 'paste'

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Not specified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
]

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// The fields Groq returns for mode:'patient-intake' — mapped straight onto the
// profile. Kept in sync with TRACKED_CLINICAL_FIELDS / the API contract.
function extractProfileFields(raw: Record<string, unknown>): Partial<PatientProfile> {
  const out: Partial<PatientProfile> = {}
  for (const f of TRACKED_CLINICAL_FIELDS) {
    const v = raw[f.key as string]
    if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[f.key as string] = v.trim()
  }
  return out
}

export default function AddPatientModal({ open, onClose, onSaved }: AddPatientModalProps) {
  const { user } = useAuth()
  const [phase, setPhase] = useState<Phase>('details')
  const [name, setName] = useState('')
  const [urNumber, setUrNumber] = useState('')
  const [gender, setGender] = useState('')
  const [genderOpen, setGenderOpen] = useState(false)
  const [urNumeric, setUrNumeric] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [permError, setPermError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const urRef = useRef<HTMLInputElement>(null)
  const genderRef = useRef<HTMLDivElement>(null)
  const {
    duration, audioSavedMin, transcribedMin, failures, lastError, micLost,
    start, stop, error: recError,
  } = useSegmentedRecorder()

  useEffect(() => {
    if (!open) {
      setPhase('details')
      setName('')
      setUrNumber('')
      setGender('')
      setGenderOpen(false)
      setUrNumeric(true)
      setPasteText('')
      setNameError(null)
      setSaving(false)
      setPermError(null)
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
  }, [open])

  useEffect(() => {
    if (!genderOpen) return
    function onDown(e: Event) {
      if (genderRef.current && !genderRef.current.contains(e.target as Node)) setGenderOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [genderOpen])

  function goToMethod() {
    if (!name.trim()) { setNameError('Name is required'); return }
    setNameError(null)
    setPhase('method')
  }

  // Persist the tracked patient. Extra clinical fields (from dictation) merge in;
  // name + UR always come from step 1. Always tracked:true so it shows in the
  // Table view. Returns the saved profile (with id) or null on failure.
  async function persist(extra: Partial<PatientProfile>): Promise<PatientProfile | null> {
    if (!user) return null
    const now = Date.now()
    const profile: PatientProfile = {
      displayName: name.trim(),
      tracked: true,
      createdAt: now,
      updatedAt: now,
      ...(urNumber.trim() ? { urNumber: urNumber.trim() } : {}),
      ...(gender ? { gender: gender as PatientProfile['gender'] } : {}),
      ...extra,
    }
    try {
      const id = await savePatientProfile(user.uid, profile)
      return { ...profile, id }
    } catch {
      return null
    }
  }

  // Run text (a dictation transcript, or a note pasted from the hospital record)
  // through the AI field extractor. Returns {} on any failure so the patient is
  // still saved with whatever we already have rather than being lost.
  async function extractFields(text: string, textSource: 'dictation' | 'paste'): Promise<Partial<PatientProfile>> {
    if (!text.trim()) return {}
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const gk = getGroqKey()
      if (gk) headers['x-groq-key'] = gk
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'patient-intake', source: textSource, transcript: text }),
      })
      const data = await res.json() as { patientFields?: Record<string, unknown>; error?: string }
      return data.patientFields ? extractProfileFields(data.patientFields) : {}
    } catch {
      return {}
    }
  }

  // Open the paste step, pre-filling from the clipboard when the browser allows
  // it (the doctor has just copied the note, so it's almost always what they want).
  async function goToPaste() {
    setPermError(null)
    setPhase('paste')
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) setPasteText(text)
    } catch { /* clipboard blocked — they can paste by hand */ }
  }

  async function handleExtractPaste() {
    if (!pasteText.trim()) return
    if (!getGroqKey()) {
      setPermError('A Groq API key is required to read the note. Add one in Settings → API Keys, or enter the details manually.')
      return
    }
    setPhase('processing')
    const extra = await extractFields(pasteText, 'paste')
    const saved = await persist(extra)
    if (saved) onSaved(saved)
    else { setPermError('Could not save the patient. Check your connection and try again.'); setPhase('paste') }
  }

  async function saveManual() {
    setSaving(true)
    const saved = await persist({})
    setSaving(false)
    if (saved) onSaved(saved)
    else setPermError('Could not save the patient. Check your connection and try again.')
  }

  async function handleStartDictation() {
    setPermError(null)
    if (!user) { setPermError('Please sign in and try again.'); return }
    if (!getGroqKey()) {
      setPermError('A Groq API key is required to transcribe. Add one in Settings → API Keys, or enter the details manually.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      start(stream, { uid: user.uid, mode: 'dictation', letterType: 'patient-intake' })
      setPhase('recording')
    } catch {
      setPermError('Microphone access denied. Please allow access and try again.')
    }
  }

  async function handleStopDictation() {
    setPhase('processing')
    const result = await stop()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // The intake draft has served its purpose — clear it so it doesn't surface
    // as an "unfinished recording" in the note-recovery flow.
    if (user) deleteTranscriptDraft(user.uid).catch(() => {})

    // Failures fall through with {} — the patient is still saved with name + UR
    // so a dictation is never lost.
    const extra = await extractFields(result.text, 'dictation')
    const saved = await persist(extra)
    if (saved) onSaved(saved)
    else { setPermError('Could not save the patient. Check your connection and try again.'); setPhase('method') }
  }

  function handleCancelRecording() {
    stop().catch(() => {})
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    // The intake draft is tagged 'patient-intake' and is not a recoverable note —
    // clear it so it can't surface in the note-recovery banner.
    if (user) deleteTranscriptDraft(user.uid).catch(() => {})
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={phase === 'recording' ? handleCancelRecording : onClose}
      title="Add patient"
      maxWidth="md"
    >
      <div className="px-5 pb-5 space-y-4">
        {(permError ?? recError) && (
          <p className="text-sm text-[var(--danger)]">{permError ?? recError}</p>
        )}

        {/* Step 1 — name + UR */}
        {phase === 'details' && (
          <>
            <p className="text-sm text-[var(--text2)]">
              Start with the patient&apos;s name and UR number. You can dictate the rest next.
            </p>
            <Input
              label="Patient name"
              value={name}
              onChange={e => { setName(capitalizeName(e.target.value)); setNameError(null) }}
              error={nameError ?? undefined}
              placeholder="e.g. Jane Smith"
              autoCapitalize="words"
              autoFocus
            />
            <div className="w-full">
              <label htmlFor="ur-number" className="block text-sm font-medium text-[var(--text)] mb-1">UR number</label>
              <div className="relative">
                <input
                  id="ur-number"
                  ref={urRef}
                  value={urNumber}
                  onChange={e => setUrNumber(e.target.value)}
                  placeholder="e.g. 1234567"
                  inputMode={urNumeric ? 'numeric' : 'text'}
                  autoCapitalize="characters"
                  className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                             pl-3 pr-16 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                             outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
                />
                {/* Numeric keypad by default (most URs are digits); tap to switch to
                    the full keyboard for hospitals whose UR contains letters. */}
                <button
                  type="button"
                  onClick={() => { setUrNumeric(v => !v); const el = urRef.current; if (el) { el.blur(); setTimeout(() => el.focus(), 0) } }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold
                             px-2 py-1 rounded-[var(--r-sm)] border border-[var(--border)] text-[var(--text2)]
                             hover:border-[var(--blue)] hover:text-[var(--blue)] active:scale-95 transition-all"
                  aria-label={urNumeric ? 'Switch to letter keyboard' : 'Switch to number keyboard'}
                >
                  {urNumeric ? 'ABC' : '123'}
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--text3)]">Optional, but recommended — it links this record in the Table view.</p>
            </div>
            <div className="w-full" ref={genderRef}>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">Gender</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setGenderOpen(o => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={genderOpen}
                  className={`w-full flex items-center justify-between rounded-[var(--r)] border bg-white
                             px-3 py-2.5 text-sm text-[var(--text)] text-left transition-colors
                             ${genderOpen ? 'border-[var(--blue)] ring-2 ring-blue-500/10' : 'border-[var(--border)]'}`}
                >
                  <span>{GENDER_OPTIONS.find(o => o.value === gender)?.label ?? 'Not specified'}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       className={`text-[var(--text3)] transition-transform ${genderOpen ? 'rotate-180' : ''}`} aria-hidden>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {genderOpen && (
                  <div
                    role="listbox"
                    className="absolute left-0 right-0 bottom-full mb-1 z-20 rounded-[var(--r)] border border-[var(--border)]
                               bg-white overflow-hidden"
                    style={{ boxShadow: '0 8px 24px rgba(15,23,42,.12), 0 0 0 1px rgba(15,23,42,.04)' }}
                  >
                    {GENDER_OPTIONS.map(o => (
                      <button
                        key={o.value || 'none'}
                        type="button"
                        role="option"
                        aria-selected={gender === o.value}
                        onClick={() => { setGender(o.value); setGenderOpen(false) }}
                        className={`w-full flex items-center justify-between px-3 py-2.5 text-sm text-left
                                   transition-colors ${gender === o.value ? 'bg-[var(--blue-lt)] text-[var(--blue)] font-medium' : 'text-[var(--text)] hover:bg-[var(--bg)]'}`}
                      >
                        {o.label}
                        {gender === o.value && (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
              <Button variant="primary" onClick={goToMethod} className="flex-1">Next</Button>
            </div>
          </>
        )}

        {/* Step 2 — choose dictation or manual entry */}
        {phase === 'method' && (
          <>
            <p className="text-sm text-[var(--text2)]">
              How would you like to add <span className="font-semibold text-[var(--text)]">{name.trim()}</span>&apos;s details?
            </p>
            <div className="space-y-2.5">
              <button
                onClick={() => setPhase('idle')}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
                  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                  focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                  motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150"
                style={{
                  background: 'rgba(255,255,255,0.75)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                }}
              >
                <span className="text-[#10b981] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Dictate the reading note</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Speak the details — the AI fills each field</p>
                </div>
              </button>

              <button
                onClick={goToPaste}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[#10b981]/40
                  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                  focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                  motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150"
                style={{
                  background: 'rgba(255,255,255,0.75)',
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                }}
              >
                <span className="text-[#10b981] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <rect x="9" y="2" width="6" height="4" rx="1"/>
                    <path d="M5 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>
                    <path d="M15 8h5a2 2 0 0 1 2 2v2"/><path d="M9 13h6"/><path d="M9 17h4"/>
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Retrieve details from Bossnet</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Paste the ward note — the AI fills each field</p>
                </div>
              </button>

              <button
                onClick={saveManual}
                disabled={saving}
                className="w-full flex items-center gap-3 p-4 rounded-[var(--r-lg)] border border-[var(--border)]
                  text-left hover:border-[var(--blue)] hover:bg-[var(--blue-lt)]
                  focus:border-[var(--blue)] focus:bg-[var(--blue-lt)] focus:outline-none
                  disabled:opacity-60 motion-safe:active:scale-[0.97] motion-safe:transition-all motion-safe:duration-150 bg-white"
              >
                <span className="text-[var(--blue)] shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)]">Enter details in the Table view</p>
                  <p className="text-xs text-[var(--text3)] mt-0.5">Save now and type the fields yourself later</p>
                </div>
              </button>
            </div>
            <button
              onClick={() => setPhase('details')}
              className="text-xs text-[var(--text3)] hover:text-[var(--text)] transition-colors"
            >
              ← Back
            </button>
          </>
        )}

        {/* Paste from the hospital record (BOSSnet ward note / handover) */}
        {phase === 'paste' && (
          <>
            <p className="text-sm text-[var(--text2)]">
              Paste <span className="font-semibold text-[var(--text)]">{name.trim()}</span>&apos;s note from Bossnet. The AI sorts it into
              presenting issue, current issues, management, history, medications, bloods, imaging and plan.
            </p>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={9}
              placeholder="Paste the ward note here…"
              autoFocus
              className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white px-3 py-2.5
                         text-sm text-[var(--text)] placeholder:text-[var(--text3)] outline-none resize-y
                         focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
            <p className="text-[11px] text-[var(--text3)]">
              Shorthand is kept as written. Check the extracted fields before relying on them.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPhase('method')} className="flex-1">Back</Button>
              <Button variant="primary" onClick={handleExtractPaste} disabled={!pasteText.trim()} className="flex-1">
                Fill the fields
              </Button>
            </div>
          </>
        )}

        {/* Dictation intro */}
        {phase === 'idle' && (
          <>
            <p className="text-sm text-[var(--text2)]">
              Dictating <span className="font-semibold text-[var(--text)]">{name.trim()}</span>&apos;s reading note.
              Speak these points clearly so they populate each field:
            </p>
            <ul className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-1.5">
              {TRACKED_CLINICAL_FIELDS.map(f => (
                <li key={f.key as string} className="flex gap-2 text-sm text-[var(--text2)]">
                  <span className="text-[#10b981] shrink-0">•</span>
                  <span><span className="font-medium text-[var(--text)]">{f.label}</span> — {f.hint}</span>
                </li>
              ))}
            </ul>
            <Button onClick={handleStartDictation} variant="primary" className="w-full">Start dictating</Button>
            <button
              onClick={() => setPhase('method')}
              className="text-xs text-[var(--text3)] hover:text-[var(--text)] transition-colors"
            >
              ← Back
            </button>
          </>
        )}

        {/* Recording */}
        {phase === 'recording' && (
          <div className="text-center py-2 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${micLost ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="text-2xl font-mono font-semibold text-[var(--text)]">{formatDuration(duration)}</span>
            </div>
            <p className="text-sm text-[var(--text3)]">
              {micLost ? 'Paused — waiting for the microphone…' : `Dictating ${name.trim()}'s details…`}
            </p>
            {!micLost && (
              <p className="text-[11px] text-[var(--text3)]">Keep your screen on — iOS pauses recording if the phone is locked.</p>
            )}
            {audioSavedMin > 0 && (
              <p className="text-xs text-[#10b981] font-medium">~{audioSavedMin} min of audio safely captured</p>
            )}
            {transcribedMin > 0 && (
              <p className="text-xs text-[var(--text3)]">~{transcribedMin} min transcribed</p>
            )}
            {failures > 0 && (
              <p className="text-xs text-[var(--danger)] font-medium">⚠ {failures} segment(s) couldn&apos;t transcribe{lastError ? ` — ${lastError}` : ''}.</p>
            )}
            <ul className="text-left rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-1.5">
              {TRACKED_CLINICAL_FIELDS.map(f => (
                <li key={f.key as string} className="flex gap-2 text-xs text-[var(--text2)]">
                  <span className="text-[#10b981] shrink-0">•</span>
                  <span><span className="font-medium text-[var(--text)]">{f.label}</span> — {f.hint}</span>
                </li>
              ))}
            </ul>
            <Button onClick={handleStopDictation} variant="danger" className="w-full">Stop &amp; save</Button>
          </div>
        )}

        {/* Processing */}
        {phase === 'processing' && (
          <div className="text-center py-8">
            <svg width="28" height="28" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)] mx-auto mb-3" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
            </svg>
            <p className="text-sm text-[var(--text2)]">Reading the details &amp; saving {name.trim()}…</p>
          </div>
        )}

        {phase === 'method' && getGroqKey() == null && (
          <p className="text-xs text-[var(--text3)] text-center">
            Dictation needs a{' '}
            <button onClick={() => openSettings('api-keys')} className="text-[var(--blue)] underline">Groq API key</button>.
          </p>
        )}
      </div>
    </Modal>
  )
}
