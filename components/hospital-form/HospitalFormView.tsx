'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { saveNote, updateNote } from '@/lib/firestore/notes'
import { deleteTranscriptDraft } from '@/lib/firestore/transcriptDrafts'
import { getGroqKey, serializeHospitalFormData } from '@/lib/utils'
import HospitalFormEditor, { type HospitalFormEditorHandle } from './HospitalFormEditor'
import type { HospitalFormData, NoteInput } from '@/types'

export function emptyFormData(formKey: string): HospitalFormData {
  return { formKey, pid: { urNo: '', surname: '', givenNames: '', dob: '', sex: '' }, noteText: '', dateTime: { date: '', time: '' } }
}

function nowDateTime() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return { date: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

function autoSlashDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  let fmt = digits.slice(0, 2)
  if (digits.length > 2) fmt += '/' + digits.slice(2, 4)
  if (digits.length > 4) fmt += '/' + digits.slice(4, 8)
  return fmt
}

const INPUT = 'w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors'

// The hospital form inside the Edit tab (plain fields, like a letter editor) and
// the Export tab (readOnly=true → the ruled-form preview + Download PDF). All
// state lives in the store so both tabs share it. Generation + autosave run in
// edit mode only.
export default function HospitalFormView({ readOnly = false }: { readOnly?: boolean }) {
  const { user, profile } = useAuth()
  const store = useNoteStore()
  const storeRef = useRef(store)
  storeRef.current = store

  const form = store.hospitalForm
  const value = store.hospitalFormData

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [toast, setToast] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  const editorRef = useRef<HospitalFormEditorHandle>(null)
  const lastSavedRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)
  const draftClearedRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const initedRef = useRef(false)
  useEffect(() => {
    if (initedRef.current || !form || readOnly) return
    initedRef.current = true
    const s = storeRef.current
    if (!s.hospitalFormData) s.setHospitalFormData({ ...emptyFormData(form.formKey), dateTime: nowDateTime() })
    else lastSavedRef.current = serializeHospitalFormData(s.hospitalFormData) ?? null
    if (s.pendingHospitalFormGeneration && s.lastTranscript) {
      s.setPendingHospitalFormGeneration(false)
      void generate(s.lastTranscript)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, readOnly])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function generate(transcript: string) {
    const cfg = storeRef.current.hospitalForm
    if (!cfg) return
    setIsGenerating(true); setGenError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/generate', { method: 'POST', headers, body: JSON.stringify({ mode: 'hospital-form', transcript, formName: cfg.name }) })
      const data = await res.json() as { formFields?: Record<string, unknown>; error?: string }
      if (data.formFields) {
        const f = data.formFields
        const str = (k: string) => (f[k] !== undefined && f[k] !== null ? String(f[k]) : '')
        const cur = storeRef.current.hospitalFormData ?? emptyFormData(cfg.formKey)
        storeRef.current.setHospitalFormData({
          ...cur,
          pid: {
            urNo: str('urNo') || cur.pid.urNo, surname: str('surname') || cur.pid.surname,
            givenNames: str('givenNames') || cur.pid.givenNames, dob: str('dob') || cur.pid.dob, sex: str('sex') || cur.pid.sex,
          },
          noteText: str('noteText') || cur.noteText,
        })
        setToast('Form populated from dictation')
      } else {
        setGenError(data.error === 'rate_limit' ? 'AI is rate-limited. Try again shortly.' : (data.error || 'Generation failed. Fill the form manually.'))
      }
    } catch { setGenError('Generation failed. Fill the form manually.') }
    finally { if (mountedRef.current) setIsGenerating(false) }
  }

  const doAutoSave = useCallback(async () => {
    const s = storeRef.current
    const cfg = s.hospitalForm
    const v = s.hospitalFormData
    if (!cfg || !v || !user || isSavingRef.current) return
    const patient = [v.pid.givenNames, v.pid.surname].filter(Boolean).join(' ').trim()
    if (!patient) return
    const serialized = serializeHospitalFormData(v) ?? ''
    if (serialized === lastSavedRef.current) return
    const noteData: NoteInput = {
      userId: user.uid, patient, reg_number: (v.pid.urNo || '').slice(0, 100),
      date: v.dateTime.date || '', time: v.dateTime.time || '', clinician: profile?.displayName ?? '',
      session_number: '', attendance: '', diagnosis: '', presentation: '', history: '',
      medications: '', mse: '', content: (v.noteText || '').slice(0, 15000),
      scales: '', risk: '', referrals: '', summary: '', nextsteps: '',
      docType: 'hospital-form', formData: serialized,
      transcript: s.lastTranscript ? s.lastTranscript.slice(0, 50000) : undefined,
      transcriptMode: s.lastTranscriptMode,
    }
    isSavingRef.current = true
    setSaveState('saving')
    try {
      if (s.hospitalFormNoteId) await updateNote(s.hospitalFormNoteId, noteData)
      else { const id = await saveNote(noteData); s.setHospitalFormNoteId(id) }
      lastSavedRef.current = serialized
      if (s.lastTranscript?.trim() && !draftClearedRef.current) { draftClearedRef.current = true; deleteTranscriptDraft(user.uid).catch(() => {}) }
      if (mountedRef.current) { setSaveState('saved'); setTimeout(() => { if (mountedRef.current) setSaveState('idle') }, 1500) }
    } catch { if (mountedRef.current) setSaveState('idle') }
    finally { isSavingRef.current = false }
  }, [user, profile])

  const doAutoSaveRef = useRef(doAutoSave)
  doAutoSaveRef.current = doAutoSave

  useEffect(() => {
    if (readOnly || !form || !user || isGenerating) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { doAutoSaveRef.current() }, 900)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [value, form, user, isGenerating, readOnly])

  useEffect(() => () => { if (!readOnly) doAutoSaveRef.current() }, [readOnly])

  const setPid = (k: keyof HospitalFormData['pid'], v: string) => { if (value) store.setHospitalFormData({ ...value, pid: { ...value.pid, [k]: v } }) }
  const setField = (patch: Partial<HospitalFormData>) => { if (value) store.setHospitalFormData({ ...value, ...patch }) }

  function handleNew() {
    if (!form) return
    if (!window.confirm('Start a new blank form? The current one stays saved in your records.')) return
    store.setHospitalFormNoteId(null)
    lastSavedRef.current = null
    draftClearedRef.current = false
    store.setLastTranscript(null)
    store.setHospitalFormData({ ...emptyFormData(form.formKey), dateTime: nowDateTime() })
  }

  async function handleDownload() {
    try { await editorRef.current?.downloadPdf() } catch { setToast('Could not build the PDF.') }
  }

  if (!form || !value) {
    return (
      <div className="h-full flex items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 24 24" className="animate-spin text-[var(--blue)]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg>
      </div>
    )
  }

  const bar = (
    <div className="sticky z-20 mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-[var(--r-lg)] text-white text-sm"
      style={{ top: 'calc(env(safe-area-inset-top) + 8px)', background: 'linear-gradient(to right, #1d4ed8, #2563eb)', boxShadow: '0 4px 16px rgba(15,23,42,.25)' }}>
      <span className="font-medium truncate">{form.name}</span>
      {!readOnly && saveState !== 'idle' && <span className="text-[11px] text-white/80">{saveState === 'saving' ? 'Saving…' : 'Saved'}</span>}
      {isGenerating && <span className="text-[11px] text-white/90">Generating…</span>}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        {!readOnly && <button onClick={handleNew} className="text-xs px-2.5 py-1.5 rounded border border-white/40 hover:bg-white/10 motion-safe:transition-colors">New</button>}
        {readOnly && <button onClick={handleDownload} className="text-xs bg-white text-[var(--blue)] font-semibold px-3 py-1.5 rounded motion-safe:active:scale-95 motion-safe:transition-transform">Download PDF</button>}
      </div>
    </div>
  )

  // Export tab: the ruled-form preview + Download.
  if (readOnly) {
    return (
      <div className="h-full overflow-y-auto scrollbar-none pb-tabbar pt-header bg-[#888]">
        {bar}
        <div className="py-4">
          <HospitalFormEditor ref={editorRef} form={form} value={value} signatureUrl={profile?.signatureUrl} signatureScale={profile?.signatureScale} />
        </div>
      </div>
    )
  }

  // Edit tab: plain fields (like a letter editor).
  return (
    <div className="h-full overflow-y-auto scrollbar-none pb-tabbar pt-header bg-[var(--bg)]">
      {bar}
      {genError && <div className="mx-4 mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-[var(--danger)]">{genError}</div>}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-xs font-medium text-[var(--text2)]">UR No
            <input className={INPUT} value={value.pid.urNo} onChange={e => setPid('urNo', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-[var(--text2)]">Surname
            <input className={INPUT} value={value.pid.surname} onChange={e => setPid('surname', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-[var(--text2)]">Given Names
            <input className={INPUT} value={value.pid.givenNames} onChange={e => setPid('givenNames', e.target.value)} />
          </label>
          <label className="text-xs font-medium text-[var(--text2)]">Date of Birth
            <input className={INPUT} inputMode="numeric" placeholder="DD/MM/YYYY" value={value.pid.dob} onChange={e => setPid('dob', autoSlashDob(e.target.value))} />
          </label>
          <label className="text-xs font-medium text-[var(--text2)]">Sex
            <input className={INPUT} list="hf-sex" value={value.pid.sex}
              onChange={e => setPid('sex', e.target.value)}
              onKeyDown={e => { if (e.key.toLowerCase() === 'm') { e.preventDefault(); setPid('sex', 'Male') } else if (e.key.toLowerCase() === 'f') { e.preventDefault(); setPid('sex', 'Female') } }} />
            <datalist id="hf-sex"><option value="Male" /><option value="Female" /></datalist>
          </label>
          <label className="text-xs font-medium text-[var(--text2)]">Date
            <input className={INPUT} value={value.dateTime.date} onChange={e => setField({ dateTime: { ...value.dateTime, date: e.target.value } })} />
          </label>
          <label className="text-xs font-medium text-[var(--text2)]">Time
            <input className={INPUT} value={value.dateTime.time} onChange={e => setField({ dateTime: { ...value.dateTime, time: e.target.value } })} />
          </label>
        </div>

        <label className="block text-xs font-medium text-[var(--text2)]">Progress note
          <textarea
            className={INPUT + ' mt-1 min-h-[240px] leading-relaxed'}
            value={value.noteText}
            onChange={e => setField({ noteText: e.target.value })}
            placeholder="Type the progress note. It wraps onto the form's ruled lines when you preview or export."
          />
        </label>

        <p className="text-xs text-[var(--text3)]">Preview it on the form and download the PDF from the <span className="font-medium text-[var(--text2)]">Export</span> tab.</p>
      </div>

      {toast && <div className="fixed left-1/2 -translate-x-1/2 z-[70] bg-[var(--text)] text-white text-xs rounded-full px-4 py-2 pointer-events-none select-none" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}>{toast}</div>}
    </div>
  )
}
