'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { useKeyboardCloseSafety } from '@/hooks/useKeyboardCloseSafety'
import { saveNote, updateNote, listNotes, getNote } from '@/lib/firestore/notes'
import { savePatientProfile, getPatientProfiles } from '@/lib/firestore/patients'
import { deleteTranscriptDraft } from '@/lib/firestore/transcriptDrafts'
import { updateProfile } from '@/lib/firestore/profiles'
import { buildTemplatePrompt, formatDateForLetter, calculateAgeFromDOB, autoNumberLines, stripRedundantSectionLabel, autoSessionTime, getGroqKey, getGeminiKey, withTimeout } from '@/lib/utils'
import { getPersonalisationPrefix } from '@/lib/personalisation'
import { applyTranscriptRedactions, privacyDirective, DEFAULT_TRANSCRIPT_PRIVACY } from '@/lib/redact'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import TimePicker from '@/components/ui/TimePicker'
import TemplatePicker from '@/components/modals/TemplatePicker'
import ReassignModal from '@/components/modals/ReassignModal'
import ManualGenerateModal from '@/components/modals/ManualGenerateModal'
import { parseBoldSegments } from '@/lib/pdf'
import type { Note, NoteInput, AnyTemplate, Workplace, LetterType, CustomTemplateField, CustomTemplate } from '@/types'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

function autoFormatDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
}

// Convert bullet-point lines (• item / - item) to numbered list lines (1. item).
// Counter resets on blank lines so multiple separate lists each start at 1.
function bulletsToNumbered(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let counter = 0
  for (const line of lines) {
    const m = line.match(/^([-•*])\s+(.+)$/)
    if (m) {
      counter++
      result.push(`${counter}. ${m[2]}`)
    } else {
      if (!line.trim()) counter = 0
      result.push(line)
    }
  }
  return result.join('\n')
}

// Remove any leading title the model echoed inside a section body, so the value
// we store (and show in the textarea) doesn't duplicate the field's own header.
function finalizeFields(out: Partial<Note>): Partial<Note> {
  for (const key of Object.keys(out) as (keyof Note)[]) {
    const v = (out as Record<string, string>)[key]
    if (typeof v === 'string') {
      let s = stripRedundantSectionLabel(key, v)
      s = bulletsToNumbered(s)
      ;(out as Record<string, string>)[key] = s
    }
  }
  return out
}

function parseGeneratedContent(content: string): Partial<Note> {
  const out: Partial<Note> = {}

  // Primary: [key] bracket labels - format produced by llama-3.3-70b and Gemini with these templates.
  // e.g.  [presentation] Current Presentation\n<body>\n[history] Past Medical...
  // Anchor to line-start via (?:^|\n) so inline abbreviations like [SI] or [N/A] never
  // prematurely split a section body. Keys are required to be 3+ lowercase letters,
  // which covers every template section key and eliminates uppercase clinical abbreviations.
  const DIRECT_FIELDS: Record<string, keyof Note> = {
    'presentation': 'presentation',
    'history':      'history',
    'medications':  'medications',
    'mse':          'mse',
    'content':      'content',
    'scales':       'scales',
    'risk':         'risk',
    'referrals':    'referrals',
    'summary':      'summary',
    'nextsteps':    'nextsteps',
    'diagnosis':    'diagnosis',
  }
  // Primary: [key] bracket labels. Model sometimes wraps in **bold** (**[key]**) — allow 0-2 leading/trailing asterisks.
  // Anchor to line-start; keys must be 3+ lowercase letters to exclude inline abbreviations like [SI] or [N/A].
  const bracketRx = /(?:^|\n)\*{0,2}\[([a-z]{3,})\][^\n]*\n([\s\S]*?)(?=(?:^|\n)\*{0,2}\[[a-z]{3,}\]|$)/g
  let bm = bracketRx.exec(content)
  let bracketParsed = false
  while (bm !== null) {
    const field = DIRECT_FIELDS[bm[1]]
    if (field) {
      const body = bm[2].trim()
      if (body) { (out as Record<string, string>)[field] = body; bracketParsed = true }
    }
    bm = bracketRx.exec(content)
  }
  if (bracketParsed) return finalizeFields(out)

  // Fallback: ## markdown headings (Gemini sometimes outputs these instead)
  const sectionMap: Record<string, keyof Note> = {
    'presentation':              'presentation',
    'history':                   'history',
    'medications':               'medications',
    'mental status':             'mse',
    'mse':                       'mse',
    'mental status examination': 'mse',
    'session content':           'content',
    'content':                   'content',
    'scales':                    'scales',
    'risk':                      'risk',
    'referrals':                 'referrals',
    'summary':                   'summary',
    'next steps':                'nextsteps',
    'nextsteps':                 'nextsteps',
    'diagnosis':                 'diagnosis',
  }
  const headingRx = /#{1,3}\s+([^\n]+)\n([\s\S]*?)(?=#{1,3}\s+|$)/g
  let hm = headingRx.exec(content)
  let headingParsed = false
  while (hm !== null) {
    const key = sectionMap[hm[1].trim().toLowerCase()]
    if (key) { (out as Record<string, string>)[key] = hm[2].trim(); headingParsed = true }
    hm = headingRx.exec(content)
  }
  if (headingParsed) return finalizeFields(out)

  // Last resort: whole response → content field
  out.content = content.trim()
  return finalizeFields(out)
}


function checkRegStatus(value: string, workplace: Workplace | undefined): 'valid' | 'invalid' | 'none' {
  if (!workplace || workplace.regSystem !== 'existing' || !workplace.regPattern) return 'none'
  if (!value) return 'none'
  try {
    return new RegExp(workplace.regPattern).test(value) ? 'valid' : 'invalid'
  } catch {
    return 'none'
  }
}

interface PatientEntry {
  name: string
  reg: string
  visits: number
  lastDate: string
}

interface CustomNoteFieldDef {
  id: string
  label: string
  prompt: string
  targetField: keyof Note
}

const TARGET_NOTE_FIELDS: Array<[keyof Note, string]> = [
  ['diagnosis',    'Diagnosis'],
  ['presentation', 'Presentation'],
  ['history',      'History'],
  ['medications',  'Medications'],
  ['mse',          'Mental Status Exam'],
  ['content',      'Session Content'],
  ['scales',       'Scales'],
  ['risk',         'Risk'],
  ['referrals',    'Referrals'],
  ['summary',      'Summary'],
  ['nextsteps',    'Next Steps'],
]

// Parse a fetch Response as JSON without throwing on a non-JSON body. When a
// generation request times out, Vercel returns an HTML error page, and calling
// res.json() on it throws the confusing "Unexpected token '<'" error — this
// returns null instead so callers can show a clear "timed out" message.
async function parseJsonSafe<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  const raw = await res.text()
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export default function EditPage() {
  return (
    <Suspense>
      <EditContent />
    </Suspense>
  )
}

function EditContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, profile, refreshProfile } = useAuth()
  const store = useNoteStore()

  const [fields, setFields] = useState<Partial<Note>>(() => {
    if (store.pendingAnimation) {
      // Start with only patient + reg visible; generated fields animate in
      const note = store.currentNote as Record<string, string>
      return { patient: note['patient'] || '', reg_number: note['reg_number'] || '' }
    }
    return store.currentNote
  })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [isSaving, setIsSaving] = useState(false)
  const [saveFlashFields, setSaveFlashFields] = useState<Set<string>>(new Set())
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const [fieldFocused, setFieldFocused] = useState(false)
  const [letterBarExpanded, setLetterBarExpanded] = useState(false)
  const [noteBarExpanded, setNoteBarExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [changeTemplateOpen, setChangeTemplateOpen] = useState(false)
  const [changeTemplateDefaultTab, setChangeTemplateDefaultTab] = useState<'all' | 'letters'>('all')
  const [reassignOpen, setReassignOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const patientDobMap = useRef<Map<string, string>>(new Map())
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false)
  const [visitCount, setVisitCount] = useState<number | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const autoSaveEnabledRef = useRef(true)
  // The recovery transcript draft (Firestore) is the only durable copy of an
  // interrupted recording. It must survive until the note that carries this
  // transcript is durably saved — then it is deleted once, here.
  const draftClearedRef = useRef(false)
  // Typewriter that fills the already-known header fields (patient, reg, date,
  // clinician) while the AI generates the body. cancel() snaps them to full
  // values; called when generation finishes or the component unmounts.
  const metaAnimRef = useRef<{ cancel: () => void } | null>(null)
  const latestFieldsRef = useRef<Partial<Note>>(store.currentNote)
  const formScrollRef = useRef<HTMLDivElement>(null)

  // Custom note fields
  const [customFieldOpen, setCustomFieldOpen] = useState<string | null>(null)
  const [customLabel, setCustomLabel] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customExample, setCustomExample] = useState('')
  const [customEngineering, setCustomEngineering] = useState(false)
  const [customPromptReady, setCustomPromptReady] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')
  const [customRaw, setCustomRaw] = useState('')
  const [customTarget, setCustomTarget] = useState<keyof Note>('nextsteps')
  const [customProcessed, setCustomProcessed] = useState('')
  const [customProcessing, setCustomProcessing] = useState(false)
  const [customInserted, setCustomInserted] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateSaving, setSaveTemplateSaving] = useState(false)
  const [savedCustomFields, setSavedCustomFields] = useState<CustomNoteFieldDef[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('ln_custom_fields') || '[]') } catch { return [] }
  })

  // Letter mode state - declared before effects that reference these
  const letterType = store.letterType as LetterType | null
  const isLetterMode = letterType !== null
  const letterCommonFields = store.letterCommonFields
  const referralFields = store.referralFields
  const recordsFields = store.recordsFields
  const freetextFields = store.freetextFields
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false)
  const [letterToast, setLetterToast] = useState<string | null>(null)

  // Recipient address lookup (OpenStreetMap geocoder)
  const [addrSuggestions, setAddrSuggestions] = useState<{ label: string; value: string }[]>([])
  const [addrLoading, setAddrLoading] = useState(false)
  const [addrOpen, setAddrOpen] = useState(false)

  // Letter layout (font size, line spacing, signature size) - adjusted live
  // against the real letter preview, then saved to the profile on confirm.
  // These are the app's original defaults; "Reset" restores them, and they're
  // also the fallback when the profile has no saved custom layout.
  const LETTER_LAYOUT_DEFAULTS = { sig: 60, font: 11, spacing: 1, margin: 12 }
  const [sigScaleDraft, setSigScaleDraft] = useState<number>(profile?.signatureScale ?? LETTER_LAYOUT_DEFAULTS.sig)
  const [fontSizeDraft, setFontSizeDraft] = useState<number>(profile?.letterFontSize ?? LETTER_LAYOUT_DEFAULTS.font)
  const [lineSpacingDraft, setLineSpacingDraft] = useState<number>(profile?.letterLineSpacing ?? LETTER_LAYOUT_DEFAULTS.spacing)
  const [marginDraft, setMarginDraft] = useState<number>(profile?.letterMargin ?? LETTER_LAYOUT_DEFAULTS.margin)
  const [savingLayout, setSavingLayout] = useState(false)
  const layoutTouchedRef = useRef(false)
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false)

  useEffect(() => {
    if (layoutTouchedRef.current) return
    setSigScaleDraft(profile?.signatureScale ?? LETTER_LAYOUT_DEFAULTS.sig)
    setFontSizeDraft(profile?.letterFontSize ?? LETTER_LAYOUT_DEFAULTS.font)
    setLineSpacingDraft(profile?.letterLineSpacing ?? LETTER_LAYOUT_DEFAULTS.spacing)
    setMarginDraft(profile?.letterMargin ?? LETTER_LAYOUT_DEFAULTS.margin)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.signatureScale, profile?.letterFontSize, profile?.letterLineSpacing, profile?.letterMargin])

  const layoutDirty =
    sigScaleDraft !== (profile?.signatureScale ?? LETTER_LAYOUT_DEFAULTS.sig) ||
    fontSizeDraft !== (profile?.letterFontSize ?? LETTER_LAYOUT_DEFAULTS.font) ||
    lineSpacingDraft !== (profile?.letterLineSpacing ?? LETTER_LAYOUT_DEFAULTS.spacing) ||
    marginDraft !== (profile?.letterMargin ?? LETTER_LAYOUT_DEFAULTS.margin)

  // Whether the live values already match the app defaults — when they don't,
  // the "Reset" button is offered to restore them.
  const layoutAtDefault =
    sigScaleDraft === LETTER_LAYOUT_DEFAULTS.sig &&
    fontSizeDraft === LETTER_LAYOUT_DEFAULTS.font &&
    lineSpacingDraft === LETTER_LAYOUT_DEFAULTS.spacing &&
    marginDraft === LETTER_LAYOUT_DEFAULTS.margin

  function handleResetLetterLayout() {
    layoutTouchedRef.current = true
    setSigScaleDraft(LETTER_LAYOUT_DEFAULTS.sig)
    setFontSizeDraft(LETTER_LAYOUT_DEFAULTS.font)
    setLineSpacingDraft(LETTER_LAYOUT_DEFAULTS.spacing)
    setMarginDraft(LETTER_LAYOUT_DEFAULTS.margin)
  }

  async function handleSaveLetterLayout() {
    if (!user) return
    setSavingLayout(true)
    try {
      await updateProfile(user.uid, {
        signatureScale: sigScaleDraft,
        letterFontSize: fontSizeDraft,
        letterLineSpacing: lineSpacingDraft,
        letterMargin: marginDraft,
      })
      await refreshProfile()
      layoutTouchedRef.current = false
      setLetterToast('Letter layout saved')
    } catch {
      setLetterToast('Failed to save layout')
    } finally {
      setSavingLayout(false)
    }
  }

  useEffect(() => { return () => { mountedRef.current = false; metaAnimRef.current?.cancel() } }, [])

  // While a form field is focused, the on-screen keyboard already consumes
  // most of the screen — hide the floating tab bar (via a body class the
  // layout's CSS keys off) and give back the space it reserves for it.
  useEffect(() => {
    document.body.classList.toggle('keyboard-input-focused', fieldFocused)
    return () => { document.body.classList.remove('keyboard-input-focused') }
  }, [fieldFocused])

  useKeyboardCloseSafety(setFieldFocused)

  // Auto-minimise the letter/note bar's action row the moment typing starts,
  // same as the transcript Q&A input collapsing the transcript on focus —
  // gives the field being edited the room the expanded bar would otherwise take.
  useEffect(() => {
    if (fieldFocused) { setLetterBarExpanded(false); setNoteBarExpanded(false) }
  }, [fieldFocused])

  // Bubbling focus/blur (React 17+ delegates via focusin/focusout, which
  // bubble) lets one pair of handlers on the form container cover every field
  // without touching each input/textarea/select individually. Buttons (e.g.
  // "+" add-section, calendar nav) are excluded since they don't open a
  // keyboard. On focus, also scroll the field into view once the keyboard has
  // finished animating in, so it isn't left hidden behind it.
  //
  // 'nearest' (not 'center'): centering tries to fit the WHOLE element in the
  // middle of the visible area, which is fine for short fields but forces an
  // excessive scroll for a tall one (e.g. the free-text letter body, rows=12
  // vs 2-5 elsewhere) once the keyboard has eaten half the screen - the field
  // is close to or taller than what's left, so "centering" it scrolled the
  // header out of view and left mostly blank field visible (reported, Brave).
  // 'nearest' scrolls the minimum needed to bring it into view instead.
  function handleFormFocus(e: React.FocusEvent<HTMLDivElement>) {
    const tag = e.target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
    setFieldFocused(true)
    const target = e.target as HTMLElement
    setTimeout(() => { target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, 300)
  }

  function handleFormBlur(e: React.FocusEvent<HTMLDivElement>) {
    const tag = e.target.tagName
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return
    setFieldFocused(false)
  }

  // Wraps the current selection in a textarea with **bold** or *italic*
  // markers (or, with no selection, inserts an empty pair and places the
  // cursor between them so typing continues formatted) — the same convention
  // already rendered by the note preview/PDF and the letter preview/PDF.
  // Updates the DOM value via the native setter + a real 'input' event so
  // React's onChange fires normally, whichever state setter a given field is
  // wired to (setField for note fields, store.setXFields for letter fields) -
  // this needs no per-field wiring at all.
  function applyInlineFormat(el: HTMLTextAreaElement, marker: string) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const selected = el.value.slice(start, end)
    const newValue = el.value.slice(0, start) + marker + selected + marker + el.value.slice(end)
    const newStart = start + marker.length
    const newEnd = end + marker.length

    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(el, newValue)
    el.dispatchEvent(new Event('input', { bubbles: true }))

    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(newStart, newEnd)
    })
  }

  // Ctrl/Cmd+B and Ctrl/Cmd+I while a textarea is focused, anywhere in the
  // form (note fields or letter fields, since both render inside this same
  // container) - saves typing ** or * by hand at both ends of a selection.
  function handleFormKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const isMod = e.ctrlKey || e.metaKey
    if (!isMod) return
    const key = e.key.toLowerCase()
    if (key !== 'b' && key !== 'i') return
    if (!(e.target instanceof HTMLTextAreaElement)) return
    e.preventDefault()
    applyInlineFormat(e.target, key === 'b' ? '**' : '*')
  }

  useEffect(() => {
    const s = storeRef.current
    const noteIdParam = searchParams.get('noteId')
    if (s.pendingTranscriptOnly) {
      // A captured transcript that didn't look clinical: save it under the
      // patient WITH the transcript but WITHOUT generating a note, so it's
      // never discarded. The note bar's "Generate note" button lets the doctor
      // run generation later if they decide it's worth it.
      s.setPendingTranscriptOnly(false)
      const cn = s.currentNote as Record<string, string>
      const now = new Date()
      const dd = String(now.getDate()).padStart(2, '0')
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const yyyy = now.getFullYear()
      const recorded = s.lastTranscriptMode === 'conversation' || s.lastTranscriptMode === 'dictation'
      const durationSec = recorded ? s.lastRecordingDuration : 0
      const endMs = recorded && s.lastRecordingEndTime ? s.lastRecordingEndTime : now.getTime()
      const known: Partial<Note> = {
        patient: cn['patient'] || '',
        reg_number: cn['reg_number'] || '',
        session_number: cn['session_number'] || '',
        attendance: cn['attendance'] || '',
        date: `${dd}/${mm}/${yyyy}`,
        time: autoSessionTime(endMs, durationSec),
        clinician: profile?.displayName ?? '',
      }
      latestFieldsRef.current = known
      setFields(known)
      void (async () => {
        await doAutoSave()
        const pending = s.pendingPatientProfile
        if (pending && user && known.patient) {
          await savePatientProfile(user.uid, {
            displayName: known.patient,
            ...(pending.dob ? { dob: pending.dob } : {}),
            ...(pending.gender ? { gender: pending.gender } : {}),
          }).catch(err => console.error('savePatientProfile failed', err))
          s.setPendingPatientProfile(null)
        }
      })()
      return
    }
    if (s.pendingAnimation) {
      // In-progress generation takes priority over any ?noteId= in the URL
      s.setPendingAnimation(false)
      const cn = s.currentNote as Record<string, string>
      const known: Partial<Note> = {
        patient: cn['patient'] || '',
        reg_number: cn['reg_number'] || '',
        session_number: cn['session_number'] || '',
        attendance: cn['attendance'] || '',
      }
      latestFieldsRef.current = known
      setFields(known)
      runPendingGeneration()
    } else if (noteIdParam) {
      // Opening a specific note always exits letter mode
      if (s.letterType !== null) s.resetLetterMode()
      if (noteIdParam !== s.currentNoteId) {
        loadNote(noteIdParam)
      } else {
        latestFieldsRef.current = s.currentNote
        setFields(s.currentNote)
      }
    } else {
      latestFieldsRef.current = s.currentNote
      setFields(s.currentNote)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  async function loadNote(noteId: string) {
    const note = await getNote(noteId)
    if (!note || !mountedRef.current) return
    const noteFields: Partial<Note> = {
      patient:        note.patient,
      reg_number:     note.reg_number,
      date:           note.date,
      time:           note.time,
      clinician:      note.clinician,
      session_number: note.session_number,
      attendance:     note.attendance,
      diagnosis:      note.diagnosis,
      presentation:   note.presentation,
      history:        note.history,
      medications:    note.medications,
      mse:            note.mse,
      content:        note.content,
      scales:         note.scales,
      risk:           note.risk,
      referrals:      note.referrals,
      summary:        note.summary,
      nextsteps:      note.nextsteps,
    }
    latestFieldsRef.current = noteFields
    setFields(noteFields)
    store.setCurrentNote(noteFields)
    store.setCurrentNoteId(noteId)
    if (note.transcript) {
      store.setLastTranscript(note.transcript)
      store.setLastTranscriptMode((note.transcriptMode as Parameters<typeof store.setLastTranscriptMode>[0]) ?? 'paste')
    }
  }

  useEffect(() => {
    if (!letterToast) return
    const t = setTimeout(() => setLetterToast(null), 3500)
    return () => clearTimeout(t)
  }, [letterToast])

  // Auto-generate the letter from a dictated transcript (set by the Dictate-a-letter
  // flow on the generate tab). Runs once when we land here in letter mode.
  const autoGenLetterRef = useRef(false)
  useEffect(() => {
    if (autoGenLetterRef.current) return
    if (store.pendingLetterGeneration && store.letterType && store.lastTranscript) {
      autoGenLetterRef.current = true
      store.setPendingLetterGeneration(false)
      handleGenerateFromTranscript()
    }
  }, [store.pendingLetterGeneration, store.letterType, store.lastTranscript])

  useEffect(() => {
    if (!user) return
    listNotes(user.uid).then(setAllNotes).catch(() => {})
    // Cache patient DOBs (keyed by lowercased name) so letters can pre-fill DOB.
    getPatientProfiles(user.uid)
      .then(profiles => {
        const map = new Map<string, string>()
        Object.values(profiles).forEach(p => {
          if (p.displayName && p.dob) map.set(p.displayName.trim().toLowerCase(), p.dob)
        })
        patientDobMap.current = map
      })
      .catch(() => {})
  }, [user?.uid])

  const storeRef = useRef(store)
  storeRef.current = store

  // A new transcript means a new recording draft that needs clearing after its
  // own note saves, so re-arm the one-shot deletion whenever the transcript changes.
  useEffect(() => {
    draftClearedRef.current = false
  }, [store.lastTranscript])

  const scheduleSave = useCallback((data: Partial<Note>) => {
    if (!autoSaveEnabledRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!user || !mountedRef.current) return
      setSaveStatus('saving')
      try {
        const s = storeRef.current
        const noteData: NoteInput = {
          userId: user.uid,
          patient:        data.patient        ?? '',
          reg_number:     data.reg_number     ?? '',
          date:           data.date           ?? '',
          time:           data.time           ?? '',
          clinician:      data.clinician      ?? profile?.displayName ?? '',
          session_number: data.session_number ?? '',
          attendance:     data.attendance     ?? '',
          diagnosis:      data.diagnosis      ?? '',
          presentation:   data.presentation   ?? '',
          history:        data.history        ?? '',
          medications:    data.medications    ?? '',
          mse:            data.mse            ?? '',
          content:        data.content        ?? '',
          scales:         data.scales         ?? '',
          risk:           data.risk           ?? '',
          referrals:      data.referrals      ?? '',
          summary:        data.summary        ?? '',
          nextsteps:      data.nextsteps      ?? '',
          transcript:     s.lastTranscript    ? s.lastTranscript.slice(0, 50000) : undefined,
          transcriptMode: s.lastTranscriptMode,
        }
        if (s.currentNoteId) {
          await updateNote(s.currentNoteId, noteData)
        } else {
          const id = await saveNote(noteData)
          s.setCurrentNoteId(id)
        }
        if (mountedRef.current) setSaveStatus('saved')
      } catch {
        if (mountedRef.current) setSaveStatus('idle')
      }
    }, 2000)
  }, [user, profile])

  function setField<K extends keyof Note>(key: K, value: string) {
    setFields(prev => {
      const next = { ...prev, [key]: value }
      latestFieldsRef.current = next
      store.setCurrentNote(next)
      return next
    })
  }

  // Patient autocomplete index - preserves original name casing
  const patientIndex = useMemo<PatientEntry[]>(() => {
    const seen = new Map<string, PatientEntry>()
    allNotes.forEach(n => {
      if (!n.patient) return
      const key = n.patient.toLowerCase()
      const existing = seen.get(key)
      if (!existing || (n.date || '') > existing.lastDate) {
        seen.set(key, {
          name: n.patient,
          reg: n.reg_number || '',
          visits: (existing?.visits || 0) + 1,
          lastDate: n.date || '',
        })
      }
    })
    return Array.from(seen.values())
  }, [allNotes])

  const patientMatches = useMemo<PatientEntry[]>(() => {
    const q = (fields.patient ?? '').trim().toLowerCase()
    if (!q) return []
    return patientIndex.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [fields.patient, patientIndex])

  function handlePatientInput(value: string) {
    setField('patient', value)
    setVisitCount(null)
    setPatientDropdownOpen(true)
  }

  function handleSelectPatient(p: PatientEntry) {
    const next: Partial<Note> = { ...fields, patient: p.name, reg_number: p.reg }
    setVisitCount(p.visits)
    const lastNote = allNotes
      .filter(n => n.patient.toLowerCase() === p.name.toLowerCase())
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    if (lastNote) {
      next.session_number = String((parseInt(lastNote.session_number || '0', 10) + 1))
      next.attendance = lastNote.attendance || next.attendance
    }
    latestFieldsRef.current = next
    setFields(next)
    store.setCurrentNote(next)
    doAutoSave('patient')
    setPatientDropdownOpen(false)
  }

  // Reg number validation
  const activeWorkplace = profile?.workplaces?.find(w => w.id === profile.activeWorkplaceId)
  const regStatus = useMemo(
    () => checkRegStatus(fields.reg_number ?? '', activeWorkplace),
    [fields.reg_number, activeWorkplace]
  )

  async function doAutoSave(flashField?: string) {
    if (storeRef.current.letterType !== null) return
    if (isSavingRef.current) return
    const data = latestFieldsRef.current
    if (!data.patient) return
    isSavingRef.current = true
    setIsSaving(true)
    try {
      const s = storeRef.current
      const noteData: NoteInput = {
        userId: user!.uid,
        patient:        data.patient        ?? '',
        reg_number:     data.reg_number     ?? '',
        date:           data.date           ?? '',
        time:           data.time           ?? '',
        clinician:      data.clinician      ?? profile?.displayName ?? '',
        session_number: data.session_number ?? '',
        attendance:     data.attendance     ?? '',
        diagnosis:      data.diagnosis      ?? '',
        presentation:   data.presentation   ?? '',
        history:        data.history        ?? '',
        medications:    data.medications    ?? '',
        mse:            data.mse            ?? '',
        content:        data.content        ?? '',
        scales:         data.scales         ?? '',
        risk:           data.risk           ?? '',
        referrals:      data.referrals      ?? '',
        summary:        data.summary        ?? '',
        nextsteps:      data.nextsteps      ?? '',
        transcript:     s.lastTranscript    ? s.lastTranscript.slice(0, 50000) : undefined,
        transcriptMode: s.lastTranscriptMode,
      }
      if (s.currentNoteId) {
        await updateNote(s.currentNoteId, noteData)
      } else {
        const id = await saveNote(noteData)
        s.setCurrentNoteId(id)
      }
      // The transcript is now durably in Firestore, so the recovery draft is
      // safe to remove. Do it once per transcript (not on every autosave).
      if (s.lastTranscript && s.lastTranscript.trim() && !draftClearedRef.current && user) {
        draftClearedRef.current = true
        deleteTranscriptDraft(user.uid).catch(() => {})
      }
      if (flashField && mountedRef.current) {
        setSaveFlashFields(prev => new Set(Array.from(prev).concat(flashField)))
        setTimeout(() => {
          setSaveFlashFields(prev => {
            const next = new Set(prev)
            next.delete(flashField)
            return next
          })
        }, 600)
      }
    } catch {
      // silent fail - auto-save errors are non-blocking
    } finally {
      isSavingRef.current = false
      if (mountedRef.current) setIsSaving(false)
    }
  }

  function handleFieldBlur(fieldName: string) {
    if (isLetterMode) return
    if (!autoSaveEnabledRef.current) return
    if (!latestFieldsRef.current.patient) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => { doAutoSave(fieldName) }, 800)
  }

  function triggerAutoSave() {
    const data = latestFieldsRef.current
    store.setCurrentNote(data)
    doAutoSave(undefined)
  }

  // Typewriter the already-known header fields in sequence while the AI works,
  // so the form shows activity during the generation wait instead of sitting
  // idle. Returns immediately; the AI body is still populated all at once by
  // animateFields once the response lands. Honours prefers-reduced-motion.
  function animateKnownFields(known: Array<[keyof Note, string]>) {
    metaAnimRef.current?.cancel()

    const finalize = () => {
      const next = { ...latestFieldsRef.current }
      for (const [k, v] of known) (next as Record<string, string>)[k] = v
      latestFieldsRef.current = next
      if (mountedRef.current) setFields(next)
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finalize()
      return
    }

    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null
    const stop = () => { if (interval) { clearInterval(interval); interval = null } }
    metaAnimRef.current = {
      cancel: () => { if (cancelled) return; cancelled = true; stop(); finalize() },
    }

    // Blank the known fields up front so they type in from empty.
    const blanked = { ...latestFieldsRef.current }
    for (const [k] of known) (blanked as Record<string, string>)[k] = ''
    latestFieldsRef.current = blanked
    setFields(blanked)

    let fieldIdx = 0
    const animateOne = () => {
      if (cancelled || !mountedRef.current || fieldIdx >= known.length) { stop(); return }
      const [key, value] = known[fieldIdx]
      let i = 0
      interval = setInterval(() => {
        if (cancelled || !mountedRef.current) { stop(); return }
        i++
        const slice = value.slice(0, i)
        const next = { ...latestFieldsRef.current, [key]: slice }
        latestFieldsRef.current = next
        setFields(next)
        if (i >= value.length) {
          stop()
          fieldIdx++
          animateOne()
        }
      }, 30)
    }
    animateOne()
  }

  function animateFields(noteFields: Partial<Note>) {
    // The typewriter reveal and per-field auto-scroll were deliberate delays.
    // They're removed: the generated note is populated all at once and shown
    // immediately. (AI generation itself is unchanged — same model, same tokens.)
    autoSaveEnabledRef.current = false
    setIsGenerating(false)
    setGenerationStatus(null)
    // Snap the header typewriter to its full values before merging the body in,
    // so a still-running animation can't leave a partial name/date behind.
    metaAnimRef.current?.cancel()
    metaAnimRef.current = null

    const next = { ...latestFieldsRef.current, ...noteFields }
    latestFieldsRef.current = next
    setFields(next)

    autoSaveEnabledRef.current = true

    if (mountedRef.current) {
      const form = formScrollRef.current
      if (form) form.scrollTop = 0
    }
  }

  // Auto-numbering in list fields
  function handleListKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, fieldKey: keyof Note) {
    if (e.key !== 'Enter') return
    const target = e.target as HTMLTextAreaElement
    const { selectionStart, value } = target
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const currentLine = value.slice(lineStart, selectionStart)
    const numMatch = currentLine.match(/^(\d+)\.\s/)
    if (!numMatch) return
    e.preventDefault()
    const nextNum = parseInt(numMatch[1], 10) + 1
    const insertion = `\n${nextNum}. `
    const newValue = value.slice(0, selectionStart) + insertion + value.slice(selectionStart)
    setField(fieldKey, newValue)
    setTimeout(() => {
      target.selectionStart = target.selectionEnd = selectionStart + insertion.length
    }, 0)
  }

  function handleNewNote() {
    if (saveStatus === 'saving') {
      if (!window.confirm('Discard unsaved changes and start a new note?')) return
    }
    store.resetNote()
    router.push('/generate')
  }

  function handleChangeTemplate(defaultTab: 'all' | 'letters' = 'all') {
    setChangeTemplateDefaultTab(defaultTab)
    setChangeTemplateOpen(true)
  }

  function handleTemplateChange(newTemplate: AnyTemplate, noteLength?: string) {
    setChangeTemplateOpen(false)
    const wasLetter = store.letterType !== null
    if (store.lastTranscript) {
      // Only warn before overwriting a note that already has generated content.
      // An empty note (interrupted / never generated) has nothing to lose, so go
      // straight to generation.
      if (noteHasContent && !window.confirm(`Regenerate note with "${newTemplate.title}"?`)) return
      if (wasLetter) store.resetLetterMode()
      if (noteLength) store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
      runGeneration(store.lastTranscript, newTemplate)
    } else {
      // No transcript to regenerate from — just leave letter mode (if any) and keep
      // the existing note fields. Used when switching a letter back to its note.
      if (wasLetter) store.resetLetterMode()
      store.setLastChosenTemplate(newTemplate)
      if (noteLength) store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
    }
  }

  // Switch the current patient's record into letter mode (referral / records / free text).
  // Reachable from the "Change Template" picker's Letters tab. Carries the patient name
  // (and DOB if known) into the letter so the doctor doesn't retype it.
  function handleSelectLetterType(type: LetterType) {
    setChangeTemplateOpen(false)
    const alreadyLetter = store.letterType !== null
    store.setLetterType(type)
    if (!alreadyLetter) {
      const now = new Date()
      const dd = String(now.getDate()).padStart(2, '0')
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const yyyy = now.getFullYear()
      const name = latestFieldsRef.current.patient ?? ''
      store.setLetterCommonFields({
        letterDate: `${dd}/${mm}/${yyyy}`,
        patientName: name,
        dob: patientDobMap.current.get(name.trim().toLowerCase()) ?? '',
      })
      // Scroll back to top so the letter starts visible, not at the scroll
      // position the form was at before entering letter mode
      if (formScrollRef.current) formScrollRef.current.scrollTop = 0
    }
  }

  async function runPendingGeneration(isRetry = false) {
    const s = storeRef.current
    const template = s.lastChosenTemplate
    const transcript = s.lastTranscript || ''
    if (!template || !user) return

    // Auto-fill date and clinician, then typewriter the known header fields
    // (patient, reg, date, clinician) to fill the generation wait with activity.
    const now = new Date()
    const dd = String(now.getDate()).padStart(2, '0')
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const yyyy = now.getFullYear()
    const dateStr = `${dd}/${mm}/${yyyy}`

    // Auto session Time: for recordings, derive from the captured end time and
    // duration; for pasted/typed notes, assume the top of the current hour.
    const recorded = s.lastTranscriptMode === 'conversation' || s.lastTranscriptMode === 'dictation'
    const durationSec = recorded ? s.lastRecordingDuration : 0
    const endMs = recorded && s.lastRecordingEndTime ? s.lastRecordingEndTime : now.getTime()
    const timeStr = autoSessionTime(endMs, durationSec)

    autoSaveEnabledRef.current = false
    setIsGenerating(true)

    // Set Time and Date directly (Time is a dropdown, not animated; Date must be
    // in the saved data BEFORE the pre-generation save below, or a failed
    // generation leaves a dateless note that then breaks the Recent sort).
    // session_number and attendance were already carried in via the mount effect.
    // animateKnownFields preserves all of these while it types the header fields.
    const base = { ...latestFieldsRef.current, time: timeStr, date: dateStr }
    latestFieldsRef.current = base
    setFields(base)

    // Persist the note with its transcript BEFORE generation, so a failed
    // generation can never lose the recorded session. Must run before
    // animateKnownFields blanks the header fields for the typewriter effect.
    // The post-generation save updates this same note with the AI content.
    await doAutoSave()

    const known = ([
      ['patient',    latestFieldsRef.current.patient ?? ''],
      ['reg_number', latestFieldsRef.current.reg_number ?? ''],
      ['date',       dateStr],
      ['clinician',  profile?.displayName ?? ''],
    ] as Array<[keyof Note, string]>).filter(([, v]) => v)
    animateKnownFields(known)

    const STATUS_SEQ: [string, number][] = [
      ['Analysing the consultation transcript',       1200],
      ['Identifying speaker turns and dialogue',      1800],
      ['Applying clinician and patient voice labels', 2400],
      ['Extracting clinical symptoms and history',    2200],
      ['Mapping diagnoses to ICD-10 codes',           1600],
      ['Structuring the mental state examination',    2400],
      ['Drafting the management plan and next steps', 2800],
      ['Formatting clinical note sections',           2000],
      ['Cross-referencing medications and risk',      1400],
      ['Finalising the report',                       60000],
    ]

    setGenerationStatus(STATUS_SEQ[0][0])
    const statusTimers: ReturnType<typeof setTimeout>[] = []
    let elapsed = 0
    for (let i = 1; i < STATUS_SEQ.length; i++) {
      elapsed += STATUS_SEQ[i - 1][1]
      const msg = STATUS_SEQ[i][0]
      statusTimers.push(setTimeout(() => {
        if (mountedRef.current) setGenerationStatus(msg)
      }, elapsed))
    }

    try {
      const s = storeRef.current
      const noteLength = (s.overrideNoteLength ?? profile?.personalisation?.noteLength ?? 'balanced') as import('@/types').NoteLength
      s.setOverrideNoteLength(null)
      const systemPrompt = profile ? getPersonalisationPrefix(profile, noteLength) : ''
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const geminiKey = getGeminiKey()
      if (geminiKey) headers['x-gemini-key'] = geminiKey

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transcript, templatePrompt: buildTemplatePrompt(template), systemPrompt, uid: user.uid, retry: isRetry }),
      })

      statusTimers.forEach(clearTimeout)
      if (!mountedRef.current) return

      if (!res.ok) {
        const data = await parseJsonSafe<{ error?: string; waitSeconds?: number }>(res)
        if (data?.error === 'rate_limit' && data.waitSeconds) {
          metaAnimRef.current?.cancel()
          metaAnimRef.current = null
          setIsGenerating(false)
          setGenerationStatus(null)
          autoSaveEnabledRef.current = true
          window.dispatchEvent(new CustomEvent('groq-rate-limit', {
            detail: { waitSeconds: data.waitSeconds, retry: () => runPendingGeneration(true) }
          }))
          return
        }
        throw new Error(data?.error ?? (res.status === 502 || res.status === 504 || res.status === 413 ? 'The note took too long to generate — a very long session can exceed the time limit. Please try again, or generate from a shorter section of the transcript.' : 'Generation failed'))
      }

      const data = await parseJsonSafe<{ content?: string; provider?: string; groqTokensUsed?: number }>(res)
      if (!data?.content?.trim()) throw new Error('The note took too long to generate or returned nothing. Please try again.')

      if (data.provider === 'groq') {
        setLetterToast('Note generated using Groq - Gemini daily limit reached')
      }

      const noteFields = parseGeneratedContent(data.content)
      animateFields(noteFields)

      if (!mountedRef.current) return

      // Synchronous save - note must reach Firestore before user can navigate
      storeRef.current.setCurrentNote(latestFieldsRef.current)
      await doAutoSave()

      // Create patient profile for new patients - only after note is persisted
      const pending = storeRef.current.pendingPatientProfile
      if (pending && user) {
        const patientName = latestFieldsRef.current.patient ?? storeRef.current.currentNote.patient ?? ''
        if (patientName) {
          await savePatientProfile(user.uid, {
            displayName: patientName,
            ...(pending.dob ? { dob: pending.dob } : {}),
            ...(pending.gender ? { gender: pending.gender } : {}),
          }).catch(err => console.error('savePatientProfile failed', err))
        }
        storeRef.current.setPendingPatientProfile(null)
      }

    } catch (err) {
      statusTimers.forEach(clearTimeout)
      // Snap the header fields to full values so a failed generation doesn't
      // leave a half-typed name/date in the form.
      metaAnimRef.current?.cancel()
      metaAnimRef.current = null
      if (!mountedRef.current) return
      setIsGenerating(false)
      setGenerationStatus(null)
      autoSaveEnabledRef.current = true
      setGenerationError(err instanceof Error ? err.message : 'Generation failed')
    }
  }

  async function runGeneration(transcript: string, template: AnyTemplate, isRetry = false) {
    setIsGenerating(true)
    store.setLastChosenTemplate(template)

    const statusSequence = ['Transcribing...', 'Analysing...', 'Generating...', 'Formatting...']
    let statusIdx = 0
    setGenerationStatus(statusSequence[0])
    const statusTimer = setInterval(() => {
      statusIdx = (statusIdx + 1) % statusSequence.length
      setGenerationStatus(statusSequence[statusIdx])
    }, 600)

    try {
      const noteLength = (storeRef.current.overrideNoteLength ?? profile?.personalisation?.noteLength ?? 'balanced') as import('@/types').NoteLength
      storeRef.current.setOverrideNoteLength(null)
      const systemPrompt = profile ? getPersonalisationPrefix(profile, noteLength) : ''
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const geminiKey = getGeminiKey()
      if (geminiKey) headers['x-gemini-key'] = geminiKey
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transcript, templatePrompt: buildTemplatePrompt(template), systemPrompt, uid: user!.uid, retry: isRetry }),
      })
      if (!res.ok) {
        const data = await parseJsonSafe<{ error?: string; waitSeconds?: number }>(res)
        if (data?.error === 'rate_limit' && data.waitSeconds) {
          clearInterval(statusTimer)
          setGenerationStatus(null)
          setIsGenerating(false)
          window.dispatchEvent(new CustomEvent('groq-rate-limit', {
            detail: { waitSeconds: data.waitSeconds, retry: () => runGeneration(transcript, template, true) }
          }))
          return
        }
        throw new Error(data?.error ?? (res.status === 502 || res.status === 504 || res.status === 413 ? 'The note took too long to generate — a very long session can exceed the time limit. Please try again, or generate from a shorter section of the transcript.' : 'Generation failed'))
      }
      const data = await parseJsonSafe<{ content?: string }>(res)
      if (!data?.content) throw new Error('The note took too long to generate or returned nothing. Please try again.')
      clearInterval(statusTimer)
      if (!mountedRef.current) return
      const noteFields = parseGeneratedContent(data.content)
      animateFields(noteFields)
      if (mountedRef.current) {
        storeRef.current.setCurrentNote(latestFieldsRef.current)
        await doAutoSave()
      }
    } catch (err) {
      clearInterval(statusTimer)
      setGenerationStatus(null)
      if (mountedRef.current) {
        setIsGenerating(false)
        setGenerationError(err instanceof Error ? err.message : 'Generation failed')
      }
    }
  }

  async function loadImageAsDataURL(url: string): Promise<{ dataUrl: string; w: number; h: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const MAX_W = 1240
        const scale = img.naturalWidth > MAX_W ? MAX_W / img.naturalWidth : 1
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight })
      }
      img.onerror = reject
      img.src = url
    })
  }

  // Load a storage image through the same-origin proxy so it can be drawn onto a
  // canvas for PDF export without cross-origin tainting.
  function loadPdfImage(url: string): Promise<{ dataUrl: string; w: number; h: number }> {
    return loadImageAsDataURL('/api/proxy-image?url=' + encodeURIComponent(url))
  }

  async function handleSearchAddress() {
    const query = letterCommonFields.recipientName.trim() || letterCommonFields.recipientAddress.trim()
    if (!query) { setLetterToast('Enter a recipient name first'); return }
    setAddrOpen(true)
    setAddrLoading(true)
    setAddrSuggestions([])
    try {
      const res = await fetch('/api/geocode?q=' + encodeURIComponent(query))
      const data = await res.json() as { results?: { label: string; value: string }[] }
      setAddrSuggestions(data.results ?? [])
    } catch {
      setLetterToast('Address lookup failed')
    } finally {
      setAddrLoading(false)
    }
  }

  function selectAddress(value: string) {
    store.setLetterCommonFields({ recipientAddress: value })
    setAddrOpen(false)
    setAddrSuggestions([])
  }

  function openInMaps() {
    const query = letterCommonFields.recipientName.trim() || letterCommonFields.recipientAddress.trim()
    if (query) window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query), '_blank', 'noopener,noreferrer')
  }

  async function handlePasteAddress() {
    try {
      const text = await withTimeout(navigator.clipboard.readText())
      if (text.trim()) store.setLetterCommonFields({ recipientAddress: text.trim() })
    } catch {
      setLetterToast('Unable to read clipboard — paste manually')
    }
  }

  // The exact letter body sequence, expressed as write()/para() calls. Shared by
  // the PDF export and the page-count estimate so neither can drift from the other.
  function flowLetterBody(write: (text: string, bold?: boolean) => void, para: () => void) {
    write(letterCommonFields.letterDate || '')
    para()
    write('To:')
    write(letterCommonFields.recipientName || '[Recipient Name]')
    if (letterCommonFields.recipientAddress) {
      letterCommonFields.recipientAddress.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
    }
    para()

    if (letterType !== 'freetext') {
      write(`Re: ${letterCommonFields.patientName || '[Patient Name]'}`, true)
      if (letterCommonFields.dob) write(`DOB: ${letterCommonFields.dob}`, true)
    } else {
      write(`Subject: ${letterCommonFields.patientName || '[Subject]'}`, true)
    }
    para()

    if (letterType === 'referral') {
      write(`To Dr. ${referralFields.doctorName || '[Doctor Name]'},`)
      para()
      write(`I am writing to refer to you ${letterCommonFields.patientName || '[Patient Name]'}, who was admitted to the ${referralFields.admissionUnit || '[Unit]'} from the ${formatDateForLetter(referralFields.admissionDateStart)} to the ${formatDateForLetter(referralFields.admissionDateEnd)}.`)
      para()
      const age = calculateAgeFromDOB(letterCommonFields.dob)
      const agePart = age !== null ? `${age} year old ` : ''
      const firstName = (letterCommonFields.patientName || '').split(' ')[0] || 'Patient'
      const title = referralFields.gender === 'male' ? 'Mr.' : referralFields.gender === 'female' ? 'Ms.' : ''
      write(`Thank you for seeing ${title} ${letterCommonFields.patientName || '[Patient Name]'}. ${firstName} is a ${agePart}${referralFields.gender || '[gender]'} who presented with ${referralFields.presentingComplaint || '[presenting complaint]'}.`)
      if (referralFields.secondParagraph) { para(); write(referralFields.secondParagraph) }
      para()
      write(`${referralFields.referralReason || '[reason for referral]'}${referralFields.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`)
      if (referralFields.showPastMedicalHistory && referralFields.pastMedicalHistory) {
        para(); write('Past Medical History:', true)
        referralFields.pastMedicalHistory.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
      }
      if (referralFields.showMedicationList && referralFields.medicationList) {
        para(); write('Medication List:', true)
        autoNumberLines(referralFields.medicationList).split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
      }
      para()
      write('Please do not hesitate to contact me if there are any queries regarding this referral.')
    } else if (letterType === 'records') {
      write('To whom it may concern,')
      para()
      write(`I am writing to request any correspondence or documentation from their previous visits at ${recordsFields.recordsLocation || '[Location]'}.`)
      if (recordsFields.secondParagraphRecords) { para(); write(recordsFields.secondParagraphRecords) }
    } else if (letterType === 'freetext') {
      freetextFields.freeTextContent.split('\n').map(l => l.trim()).forEach(l => {
        if (l) write(l); else para()
      })
    }
  }

  // The signature lines (name, provider/phone, position, workplace), built once so
  // the PDF and the page-count estimate use an identical block height.
  function buildSigLines(): { text: string; bold?: boolean; small?: boolean }[] {
    const sigLines: { text: string; bold?: boolean; small?: boolean }[] = [{ text: 'Thank you and kind regards,' }]
    const nameWithCreds = profile?.displayName
      ? profile?.credentials ? `${profile.displayName} (${profile.credentials})` : profile.displayName
      : ''
    if (nameWithCreds) sigLines.push({ text: nameWithCreds, bold: true })
    const providerLine = [
      profile?.providerNumber ? `Provider No: ${profile.providerNumber}` : '',
      profile?.workPhone ? `Ph no: ${profile.workPhone}` : '',
    ].filter(Boolean).join(' | ')
    if (providerLine) sigLines.push({ text: providerLine })
    if (profile?.position) sigLines.push({ text: profile.position, small: true })
    const wpName = profile?.workplaces?.find(w => w.id === profile?.activeWorkplaceId)?.name
    if (wpName) sigLines.push({ text: wpName, small: true })
    return sigLines
  }


  async function handleLetterPDF() {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const PW = 210, PH = 297
    const ML = marginDraft > 0 ? marginDraft : 20
    const MR = ML, CW = PW - ML - MR

    const fs = fontSizeDraft > 0 ? fontSizeDraft : 11
    const ls = lineSpacingDraft > 0 ? lineSpacingDraft : 1.4
    const LH = fs * 0.3528 * ls          // line advance in mm (1pt ≈ 0.3528mm)
    const PS = LH * 0.5                   // paragraph gap
    const smallFs = Math.max(7, fs - 2)

    // Load the active letterhead images (via same-origin proxy to avoid canvas taint)
    const lh = store.activeLetterhead
    let headerImg: { dataUrl: string; w: number; h: number } | null = null
    let footerImg: { dataUrl: string; w: number; h: number } | null = null
    if (lh?.headerUrl) { try { headerImg = await loadPdfImage(lh.headerUrl) } catch { headerImg = null } }
    if (lh?.footerUrl) { try { footerImg = await loadPdfImage(lh.footerUrl) } catch { footerImg = null } }

    const headerH = headerImg ? (headerImg.h / headerImg.w) * PW : 0
    const footerH = footerImg ? (footerImg.h / footerImg.w) * PW : 0
    const contentTop = headerImg ? headerH + 8 : 20
    const footerY = PH - footerH
    const maxY = footerImg ? footerY - 4 : PH - 15
    // Signature block can overlap into the footer's white curved zone (top ~42%)
    // so it sits right above the blue band rather than floating high above the footer.
    const sigZoneBottom = footerImg ? footerY + footerH * 0.42 : maxY

    const stampLetterhead = () => {
      if (headerImg) doc.addImage(headerImg.dataUrl, 'JPEG', 0, 0, PW, headerH)
      if (footerImg) doc.addImage(footerImg.dataUrl, 'JPEG', 0, footerY, PW, footerH)
    }

    let y = contentTop
    stampLetterhead()

    // Word-by-word rendering (same tokenizing approach as lib/pdf.ts's
    // drawRich) so **bold**/*italic* markdown typed via the Bold/Italic
    // shortcut renders inline within a wrapped paragraph, rather than the
    // old splitTextToSize(text) approach which could only style a whole call
    // uniformly via the `bold` flag.
    const write = (text: string, bold = false, size = fs) => {
      const segs = parseBoldSegments(text)
      const tokens: { w: string; bold: boolean; italic: boolean; space: boolean }[] = []
      for (const s of segs) {
        for (const part of s.text.split(/(\s+)/)) {
          if (!part) continue
          tokens.push({ w: part, bold: bold || s.bold, italic: s.italic, space: /^\s+$/.test(part) })
        }
      }
      const fontStyle = (b: boolean, i: boolean) => (b && i ? 'bolditalic' : b ? 'bold' : i ? 'italic' : 'normal')
      doc.setFontSize(size)
      const maxX = ML + CW
      let x = ML
      let atLineStart = true
      const startNewLine = () => {
        y += LH
        if (y + LH > maxY) { doc.addPage(); stampLetterhead(); y = contentTop }
        x = ML
        atLineStart = true
      }
      if (y + LH > maxY) { doc.addPage(); stampLetterhead(); y = contentTop }
      for (const tok of tokens) {
        if (tok.space) {
          if (atLineStart) continue
          doc.setFont('helvetica', 'normal')
          x += doc.getTextWidth(tok.w)
          continue
        }
        doc.setFont('helvetica', fontStyle(tok.bold, tok.italic))
        const tw = doc.getTextWidth(tok.w)
        if (!atLineStart && x + tw > maxX) startNewLine()
        doc.text(tok.w, x, y)
        x += tw
        atLineStart = false
      }
      y += LH
    }
    const nl = (n = 1) => { y += PS * n }

    // Para break = one full blank line. LH is already one line advance;
    // PS = LH*0.5, so nl(2) == PS*2 == LH == one blank line.
    const para = () => nl(2)

    flowLetterBody(write, para)

    // Signature block, pinned to the bottom of the page (above the footer)
    let sigDataUrl: string | null = null
    if (profile?.signatureUrl) {
      try { sigDataUrl = (await loadPdfImage(profile.signatureUrl)).dataUrl } catch { sigDataUrl = null }
    }
    const sigF = (sigScaleDraft > 0 ? sigScaleDraft : 100) / 100
    const sigImgH = sigDataUrl ? 14 * sigF + 3 : 0
    const sigLines = buildSigLines()

    const blockH = sigImgH + sigLines.length * LH
    let sy = sigZoneBottom - blockH
    if (sy < y + PS * 2) { doc.addPage(); stampLetterhead(); sy = sigZoneBottom - blockH }
    if (sy < contentTop) sy = contentTop

    const cx = PW / 2
    if (sigDataUrl) {
      try { doc.addImage(sigDataUrl, 'JPEG', cx - (40 * sigF) / 2, sy, 40 * sigF, 14 * sigF) } catch {}
      sy += 14 * sigF + 3
    }
    const smallLH = smallFs * 0.3528 * (lineSpacingDraft > 0 ? lineSpacingDraft : 1)
    for (const line of sigLines) {
      const lineSize = line.small ? smallFs : fs
      const lineAdvance = line.small ? smallLH : LH
      doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
      doc.setFontSize(lineSize)
      doc.text(line.text, cx, sy, { align: 'center' })
      sy += lineAdvance
    }

    const pname = (letterCommonFields.patientName || 'letter').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-')
    const typeLabel = letterType === 'referral' ? 'Referral' : letterType === 'records' ? 'RecordsRequest' : 'Letter'
    doc.save(`${typeLabel}_${pname}_${(letterCommonFields.letterDate || '').replace(/\//g, '-')}.pdf`)
  }

  function handleLetterEmail() {
    const subject = letterType === 'referral'
      ? `Referral: ${letterCommonFields.patientName || ''} - DOB: ${letterCommonFields.dob || ''}`
      : letterType === 'records'
      ? `Medical Records Request: ${letterCommonFields.patientName || ''}`
      : `Letter: ${letterCommonFields.patientName || ''}`

    const lines: string[] = []
    lines.push(letterCommonFields.letterDate || '')
    lines.push('')
    lines.push('To: ' + (letterCommonFields.recipientName || '[Recipient Name]'))
    if (letterCommonFields.recipientAddress) lines.push(letterCommonFields.recipientAddress)
    lines.push('')
    if (letterType !== 'freetext') {
      lines.push('Re: ' + (letterCommonFields.patientName || '[Patient Name]'))
      if (letterCommonFields.dob) lines.push('DOB: ' + letterCommonFields.dob)
    } else {
      lines.push('Subject: ' + (letterCommonFields.patientName || '[Subject]'))
    }
    lines.push('')
    if (letterType === 'referral') {
      lines.push(`To Dr. ${referralFields.doctorName || '[Doctor Name]'},`)
      lines.push('')
      lines.push(`I am writing to refer to you ${letterCommonFields.patientName || '[Patient Name]'}, who was admitted to the ${referralFields.admissionUnit || '[Unit]'} from the ${formatDateForLetter(referralFields.admissionDateStart)} to the ${formatDateForLetter(referralFields.admissionDateEnd)}.`)
      lines.push('')
      const age = calculateAgeFromDOB(letterCommonFields.dob)
      const agePart = age !== null ? `${age} year old ` : ''
      const firstName = (letterCommonFields.patientName || '').split(' ')[0] || 'Patient'
      const title = referralFields.gender === 'male' ? 'Mr.' : referralFields.gender === 'female' ? 'Ms.' : ''
      lines.push(`Thank you for seeing ${title} ${letterCommonFields.patientName || '[Patient Name]'}. ${firstName} is a ${agePart}${referralFields.gender || '[gender]'} who presented with ${referralFields.presentingComplaint || '[presenting complaint]'}.`)
      if (referralFields.secondParagraph) { lines.push(''); lines.push(referralFields.secondParagraph) }
      lines.push('')
      lines.push(`${referralFields.referralReason || '[reason for referral]'}${referralFields.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`)
      if (referralFields.showPastMedicalHistory && referralFields.pastMedicalHistory) {
        lines.push(''); lines.push('Past Medical History:'); lines.push(referralFields.pastMedicalHistory)
      }
      if (referralFields.showMedicationList && referralFields.medicationList) {
        lines.push(''); lines.push('Medication List:'); lines.push(referralFields.medicationList)
      }
      lines.push(''); lines.push('Please do not hesitate to contact me if there are any queries regarding this referral.')
    } else if (letterType === 'records') {
      lines.push('To whom it may concern,')
      lines.push('')
      lines.push(`I am writing to request any correspondence or documentation from their previous visits at ${recordsFields.recordsLocation || '[Location]'}.`)
      if (recordsFields.secondParagraphRecords) { lines.push(''); lines.push(recordsFields.secondParagraphRecords) }
    } else if (letterType === 'freetext') {
      lines.push(freetextFields.freeTextContent || '')
    }
    lines.push(''); lines.push('Kind regards,')
    if (profile?.displayName) lines.push(profile.displayName)
    if (profile?.credentials) lines.push(profile.credentials)

    const body = encodeURIComponent(lines.join('\n'))
    const sub = encodeURIComponent(subject)
    const ua = navigator.userAgent
    const isIOS = /iPhone|iPad/i.test(ua)
    const isAndroid = /Android/i.test(ua)
    const outlookUrl = isIOS
      ? `ms-outlook://compose?subject=${sub}&body=${body}`
      : isAndroid
      ? `ms-outlook://emails/new?subject=${sub}&body=${body}`
      : `https://outlook.office.com/mail/deeplink/compose?subject=${sub}&body=${body}`
    if (isIOS || isAndroid) window.location.href = outlookUrl
    else window.open(outlookUrl, '_blank')
  }

  async function handleGenerateFromTranscript() {
    if (!store.lastTranscript || !letterType) return
    setIsGeneratingLetter(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const geminiKey = getGeminiKey()
      if (geminiKey) headers['x-gemini-key'] = geminiKey
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'letter', letterType, transcript: store.lastTranscript }),
      })
      const data = await res.json() as { letterFields?: Record<string, unknown>; error?: string }
      if (data.letterFields) {
        const { recipientName, recipientAddress, patientName, dob, ...typeFields } = data.letterFields
        store.setLetterCommonFields({
          ...(recipientName !== undefined && { recipientName: String(recipientName) }),
          ...(recipientAddress !== undefined && { recipientAddress: String(recipientAddress) }),
          ...(patientName !== undefined && { patientName: String(patientName) }),
          ...(dob !== undefined && { dob: String(dob) }),
        })
        if (letterType === 'referral') store.setReferralFields(typeFields as Parameters<typeof store.setReferralFields>[0])
        else if (letterType === 'records') store.setRecordsFields(typeFields as Parameters<typeof store.setRecordsFields>[0])
        else if (letterType === 'freetext') store.setFreetextFields(typeFields as Parameters<typeof store.setFreetextFields>[0])
        setLetterToast('Fields populated from transcript')
      } else {
        setLetterToast(data.error || 'Generation failed. Fill fields manually.')
      }
    } catch {
      setLetterToast('Generation failed. Fill fields manually.')
    } finally {
      setIsGeneratingLetter(false)
    }
  }

  function handleReassign(patient: string, regNumber: string) {
    setReassignOpen(false)
    const next = { ...fields, patient, reg_number: regNumber }
    latestFieldsRef.current = next
    setFields(next)
    store.setCurrentNote(next)
    doAutoSave('patient')
  }

  // Manual generation escape hatch: assemble the same prompt the API sends (system
  // personalisation + privacy directive + template + redacted transcript) so the
  // doctor can paste it into any external AI when their quota is exhausted.
  function buildManualPrompt(): string {
    const template = store.lastChosenTemplate
    const transcript = store.lastTranscript || ''
    if (!template || !transcript) return ''
    const noteLength = (store.overrideNoteLength ?? profile?.personalisation?.noteLength ?? 'balanced') as import('@/types').NoteLength
    const base = profile ? getPersonalisationPrefix(profile, noteLength) : ''
    const privacy = profile?.transcriptPrivacy ?? DEFAULT_TRANSCRIPT_PRIVACY
    const directive = privacyDirective(privacy)
    const system = directive ? `${base}\n\n${directive}`.trim() : base.trim()
    const templatePrompt = buildTemplatePrompt(template)
    const safe = applyTranscriptRedactions(transcript, privacy)
    return `${system ? system + '\n\n' : ''}${templatePrompt}\n\nTRANSCRIPT:\n${safe}`
  }

  // Parse a manually-pasted AI result with the same parser used for API results,
  // then merge it into the note and save. Returns false if nothing parseable.
  function applyManualResult(pasted: string): boolean {
    const parsed = parseGeneratedContent(pasted)
    const hasClinical = Object.keys(parsed).some(k => k !== 'patient' && k !== 'date' && (parsed as Record<string, string>)[k]?.trim())
    if (!hasClinical) return false
    animateFields(parsed)
    store.setCurrentNote(latestFieldsRef.current)
    store.setIncompleteTranscript(false)
    doAutoSave()
    return true
  }

  // ── Custom note field handlers ────────────────────────────────────────────

  const DIVIDER_FIELD_MAP: Record<string, keyof Note> = {
    'after-attendance': 'attendance', 'after-diagnosis': 'diagnosis',
    'after-presentation': 'presentation', 'after-history': 'history',
    'after-medications': 'medications', 'after-mse': 'mse',
    'after-content': 'content', 'after-scales': 'scales',
    'after-risk': 'risk', 'after-referrals': 'referrals',
    'after-summary': 'summary', 'after-nextsteps': 'nextsteps',
  }

  function openCustomField(key: string) {
    setCustomFieldOpen(key)
    setCustomLabel('')
    setCustomPrompt('')
    setCustomRaw('')
    setCustomProcessed('')
    setCustomTarget(DIVIDER_FIELD_MAP[key] ?? 'nextsteps')
  }

  function closeCustomField() {
    setCustomFieldOpen(null)
    setCustomProcessed('')
    setCustomDescription('')
    setCustomExample('')
    setCustomPrompt('')
    setCustomPromptReady(false)
    setCustomRaw('')
    setCustomInserted(false)
    setSaveTemplateName('')
  }

  async function handleEngineerPrompt() {
    if (!customDescription.trim() || !customLabel.trim()) return
    setCustomEngineering(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'engineer-prompt',
          label: customLabel.trim(),
          description: customDescription.trim(),
          example: customExample.trim() || undefined,
          uid: user?.uid,
        }),
      })
      const data = await res.json() as { systemPrompt?: string; error?: string }
      if (data.systemPrompt) {
        setCustomPrompt(data.systemPrompt)
        setCustomPromptReady(true)
      }
    } catch {
      setCustomPromptReady(true)
    } finally {
      setCustomEngineering(false)
    }
  }

  async function handleSaveAsTemplate() {
    if (!saveTemplateName.trim() || !user?.uid || !profile) return
    setSaveTemplateSaving(true)
    try {
      const newField: CustomTemplateField = {
        id: Date.now().toString(),
        label: customLabel.trim(),
        systemPrompt: customPrompt.trim(),
        targetField: customTarget,
      }
      const baseTemplate = store.lastChosenTemplate
      // Carry forward fields from a base that is itself a derived template so
      // custom sections accumulate rather than being lost when chaining.
      const inheritedFields = baseTemplate && 'customFields' in baseTemplate && baseTemplate.customFields
        ? baseTemplate.customFields
        : []
      const basePrompt = (baseTemplate?.prompt ?? '').trim()
        || 'Generate a comprehensive clinical progress note based on the transcript.'
      const newTemplate: CustomTemplate = {
        id: 'custom_' + Date.now(),
        title: saveTemplateName.trim(),
        category: 'My Templates',
        description: `Based on "${baseTemplate?.title ?? 'default note'}" with a custom "${customLabel.trim()}" section`,
        prompt: basePrompt,
        custom: true,
        baseTemplateId: baseTemplate?.id != null ? String(baseTemplate.id) : undefined,
        customFields: [...inheritedFields, newField],
      }
      const existing = profile.customTemplates ?? []
      await updateProfile(user.uid, { customTemplates: [...existing, newTemplate] })
      setLetterToast(`Template "${newTemplate.title}" saved`)
      closeCustomField()
    } catch {
      setLetterToast('Could not save template')
    } finally {
      setSaveTemplateSaving(false)
    }
  }

  async function handleStandardize() {
    if (!customRaw.trim()) return
    setCustomProcessing(true)
    setCustomProcessed('')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'standardize',
          rawInput: customRaw,
          prompt: customPrompt.trim() || `Write professional clinical notes for the section "${customLabel || 'Custom'}"`,
          uid: user?.uid,
        }),
      })
      const data = await res.json() as { result?: string; error?: string }
      setCustomProcessed(data.result ?? ('Error: ' + (data.error || 'Processing failed')))
    } catch {
      setCustomProcessed('Error: Request failed')
    } finally {
      setCustomProcessing(false)
    }
  }

  function handleInsertCustomField() {
    if (!customProcessed || customProcessed.startsWith('Error:')) return
    const label = customLabel.trim() || 'Custom'
    const current = (fields[customTarget] as string | undefined) ?? ''
    const appended = current.trim() ? `${current}\n\n${label}:\n${customProcessed}` : `${label}:\n${customProcessed}`
    setField(customTarget, appended)
    doAutoSave(String(customTarget))
    const base = store.lastChosenTemplate
    setSaveTemplateName(base ? `${base.title} + ${label}` : label)
    setCustomInserted(true)
  }

  function saveCustomFieldDef() {
    if (!customLabel.trim()) return
    const def: CustomNoteFieldDef = {
      id: Date.now().toString(),
      label: customLabel.trim(),
      prompt: customPrompt.trim(),
      targetField: customTarget,
    }
    const updated = [...savedCustomFields, def]
    setSavedCustomFields(updated)
    localStorage.setItem('ln_custom_fields', JSON.stringify(updated))
  }

  function deleteCustomFieldDef(id: string) {
    const updated = savedCustomFields.filter(f => f.id !== id)
    setSavedCustomFields(updated)
    localStorage.setItem('ln_custom_fields', JSON.stringify(updated))
  }

  function renderCustomFieldForm() {
    const templateFields = (store.lastChosenTemplate && 'customFields' in store.lastChosenTemplate && store.lastChosenTemplate.customFields) || []
    const allSaved = [
      ...templateFields.map(f => ({ id: f.id, label: f.label, prompt: f.systemPrompt, targetField: f.targetField })),
      ...savedCustomFields,
    ]
    const targetLabel = TARGET_NOTE_FIELDS.find(([k]) => k === customTarget)?.[1] ?? String(customTarget)

    return (
      <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-3 space-y-2.5 mb-1"
        style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06)' }}>

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--text)]">Add custom section</span>
          <button type="button" onClick={closeCustomField} className="text-[var(--text3)] hover:text-[var(--text)] text-xl leading-none">×</button>
        </div>

        {/* Quick-load saved fields */}
        {allSaved.length > 0 && !customInserted && (
          <div className="flex flex-wrap gap-1.5">
            {allSaved.map(def => (
              <div key={def.id} className="flex items-center">
                <button type="button"
                  onClick={() => {
                    setCustomLabel(def.label)
                    setCustomPrompt(def.prompt)
                    setCustomTarget(def.targetField)
                    setCustomPromptReady(true)
                  }}
                  className="text-xs bg-[var(--bg)] border border-[var(--border)] rounded-l-full px-2.5 py-0.5 text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)]">
                  {def.label}
                </button>
                {savedCustomFields.some(s => s.id === def.id) && (
                  <button type="button" onClick={() => deleteCustomFieldDef(def.id)}
                    className="text-xs bg-[var(--bg)] border border-l-0 border-[var(--border)] rounded-r-full px-1.5 py-0.5 text-[var(--text3)] hover:text-[var(--danger)] hover:border-[var(--danger)]">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── PHASE: After inserting - offer to save as template ── */}
        {customInserted ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs text-[#059669] font-medium">
              <span>✓</span>
              <span>Added to {targetLabel}</span>
            </div>
            <div className="rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] p-3 space-y-2.5">
              <p className="text-xs font-semibold text-[var(--text)]">Save as a new template?</p>
              <p className="text-xs text-[var(--text3)] leading-relaxed">
                This creates a new template based on &ldquo;{store.lastChosenTemplate?.title ?? 'your current template'}&rdquo; that always includes the <strong>{customLabel.trim() || 'custom'}</strong> field - ready to use in future sessions.
              </p>
              <Input
                label="Template name"
                value={saveTemplateName}
                onChange={e => setSaveTemplateName(e.target.value)}
                placeholder={`e.g. ${store.lastChosenTemplate?.title ?? 'My Template'} + ${customLabel.trim() || 'Custom'}`}
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleSaveAsTemplate}
                  disabled={!saveTemplateName.trim() || saveTemplateSaving}
                  className="flex-1 text-xs font-semibold bg-[var(--blue)] text-white rounded-[var(--r)] py-2 disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform">
                  {saveTemplateSaving ? 'Saving…' : 'Save template'}
                </button>
                <button type="button" onClick={closeCustomField}
                  className="text-xs text-[var(--text2)] border border-[var(--border)] rounded-[var(--r)] px-4 py-2 hover:bg-[var(--bg)]">
                  Skip
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* ── PHASE 1: Describe → Generate AI instructions ── */}
            {!customPromptReady ? (
              <div className="space-y-2.5">
                <Input
                  label="Section name"
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  placeholder="e.g. Sleep History, Immunisation Status"
                />
                <Textarea
                  label="What should this section do?"
                  rows={3}
                  value={customDescription}
                  onChange={e => setCustomDescription(e.target.value)}
                  placeholder={'Describe in plain language, like asking a colleague - e.g. "I want a paragraph summarising the patient\'s sleep patterns: how many hours they get, any disturbances or early waking, and whether it has improved since last session."'}
                />
                <Textarea
                  label="Example output (optional - helps AI match your style)"
                  rows={2}
                  value={customExample}
                  onChange={e => setCustomExample(e.target.value)}
                  placeholder={'e.g. "The patient reports sleeping approximately 5 hours per night with 3-4 nocturnal awakenings over the past 2 weeks, representing a mild improvement from the previous session."'}
                />
                <div className="flex items-center gap-3">
                  <button type="button"
                    onClick={handleEngineerPrompt}
                    disabled={!customLabel.trim() || !customDescription.trim() || customEngineering}
                    className="flex-1 py-2 text-xs font-semibold bg-[var(--blue)] text-white rounded-[var(--r)] disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform">
                    {customEngineering ? 'Generating AI instructions…' : '✦ Generate AI Instructions'}
                  </button>
                  <button type="button"
                    onClick={() => { setCustomPromptReady(true) }}
                    className="text-xs text-[var(--text3)] hover:text-[var(--blue)] shrink-0">
                    Write manually
                  </button>
                </div>
              </div>
            ) : (
              /* ── PHASE 2+: Edit prompt, enter raw notes, standardize ── */
              <div className="space-y-2.5">
                <Input
                  label="Section name"
                  value={customLabel}
                  onChange={e => setCustomLabel(e.target.value)}
                  placeholder="e.g. Sleep History"
                />
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-medium text-[var(--text)]">AI Instructions</label>
                    <button type="button" onClick={() => { setCustomPromptReady(false); setCustomPrompt('') }}
                      className="text-xs text-[var(--text3)] hover:text-[var(--blue)]">
                      Regenerate
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    placeholder="AI will write instructions here - or type your own"
                    className="w-full rounded-[var(--r)] border border-[var(--blue)] bg-[var(--blue-lt)] px-3 py-2 text-xs text-[var(--text)] outline-none focus:ring-2 focus:ring-blue-500/10 resize-none leading-relaxed"
                  />
                  <p className="text-xs text-[var(--text3)]">Review and edit if needed - this is the exact instruction the AI will follow.</p>
                </div>
                <Textarea
                  label="Your raw notes"
                  rows={4}
                  value={customRaw}
                  onChange={e => setCustomRaw(e.target.value)}
                  placeholder={'Jot notes exactly as you would on paper - e.g. "pt slept 5hrs, woke 3am, groggy next day". Typos are fine - AI will clean it up.'}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text3)]">
                    Adding to:{' '}
                    <select value={customTarget as string} onChange={e => setCustomTarget(e.target.value as keyof Note)}
                      className="text-xs text-[var(--blue)] font-medium bg-transparent border-none outline-none cursor-pointer hover:underline">
                      {TARGET_NOTE_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </span>
                  <button type="button" onClick={handleStandardize} disabled={!customRaw.trim() || customProcessing}
                    className="px-4 py-1.5 text-xs font-semibold bg-[var(--blue)] text-white rounded-[var(--r)] disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform">
                    {customProcessing ? 'Processing…' : '✦ Standardize'}
                  </button>
                </div>

                {/* Result */}
                {customProcessed && !customProcessed.startsWith('Error:') && (
                  <div className="space-y-2 pt-1 border-t border-[var(--border)]">
                    <p className="text-xs font-medium text-[var(--text3)]">Processed result</p>
                    <div className="text-xs text-[var(--text2)] bg-[var(--bg)] rounded-[var(--r)] p-2.5 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
                      {customProcessed}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleInsertCustomField}
                        className="flex-1 text-xs font-semibold bg-[#10b981] text-white rounded-[var(--r)] py-2 motion-safe:active:scale-95 motion-safe:transition-transform">
                        Add to {targetLabel}
                      </button>
                      <button type="button" onClick={saveCustomFieldDef} disabled={!customLabel.trim()}
                        className="text-xs text-[var(--text2)] border border-[var(--border)] rounded-[var(--r)] px-3 py-2 hover:bg-[var(--bg)] disabled:opacity-40">
                        Save field
                      </button>
                    </div>
                  </div>
                )}
                {customProcessed.startsWith('Error:') && (
                  <p className="text-xs text-[var(--danger)]">{customProcessed}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  function renderDivider(key: string) {
    const isOpen = customFieldOpen === key
    return (
      <>
        <button type="button" onClick={() => isOpen ? closeCustomField() : openCustomField(key)}
          className="flex items-center gap-2 w-full py-0.5 group" title="Add custom section">
          <span className={`text-sm font-bold shrink-0 motion-safe:transition-colors ${isOpen ? 'text-[var(--blue)]' : 'text-[var(--text3)] group-hover:text-[var(--text2)]'}`}>{isOpen ? '−' : '+'}</span>
          <div className={`flex-1 h-px motion-safe:transition-colors ${isOpen ? 'bg-[var(--blue)]' : 'bg-[var(--border)] group-hover:bg-[var(--text3)]'}`} />
        </button>
        {isOpen && renderCustomFieldForm()}
      </>
    )
  }

  const sessionStats = store.lastTranscript && store.lastRecordingDuration > 0
    ? (() => {
        const wordCount = store.lastTranscript.trim().split(/\s+/).filter(Boolean).length
        const durationSeconds = store.lastRecordingDuration
        const wpm = durationSeconds > 0 ? Math.round(wordCount / (durationSeconds / 60)) : 0
        return { durationSeconds, wordCount, wpm }
      })()
    : null

  const ADMISSION_UNITS = [
    'Emergency Department', 'Surgical Unit', 'Medical Unit',
    'Psychiatric Unit', 'ICU', 'Oncology Unit', 'Outpatient Clinic',
  ]

  // Floating overlay geometry — bars sit above content, content scrolls behind them.
  // HEADER_BOTTOM = safe-area + 8px gap + 60px header + 8px gap (matches .pt-header = 76px)
  const HEADER_BOTTOM = 76
  // approximate bar visual height + gap below it. The letter bar grows by a
  // second row when expanded. The note bar's actions sit inline on the header
  // row on desktop (no extra height); on mobile they drop to a second row only
  // when the chevron is expanded.
  const BAR_H = 44
    + (isLetterMode && letterBarExpanded ? 48 : 0)
    + (!isLetterMode && !isGenerating && noteBarExpanded ? 48 : 0)
  const hasTopBar = isLetterMode || (!isLetterMode && (!!store.currentNoteId || isGenerating))
  const barTop = `calc(env(safe-area-inset-top) + ${HEADER_BOTTOM}px)`
  const contentPt = `calc(env(safe-area-inset-top) + ${HEADER_BOTTOM + (hasTopBar ? BAR_H : 0) + 16}px)`
  const errorTop = `calc(env(safe-area-inset-top) + ${HEADER_BOTTOM + (hasTopBar ? BAR_H + 4 : 4)}px)`

  // A note whose clinical sections are all still empty but which carries a
  // transcript — i.e. generation never ran or was interrupted after the note
  // itself was saved. It should offer a clear "Generate note" action rather
  // than only the "Change Template" wording, which reads oddly with no note yet.
  const NOTE_CONTENT_KEYS: (keyof Note)[] = [
    'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content',
    'scales', 'risk', 'referrals', 'summary', 'nextsteps',
  ]
  const noteHasContent = NOTE_CONTENT_KEYS.some(k => String(fields[k] ?? '').trim())
  const canGenerateFromTranscript = !isLetterMode && !!store.lastTranscript && !noteHasContent

  // The note bar's action buttons, rendered in two places: inline on the header
  // row at desktop widths, and in a collapsible second row on mobile. Defined
  // once so the two placements stay identical.
  const noteActionButtons = (
    <>
      {canGenerateFromTranscript ? (
        <button onClick={() => handleChangeTemplate()} className="text-[var(--blue)] bg-white hover:bg-white/90 text-xs font-semibold px-2.5 py-1 rounded border border-white motion-safe:active:scale-95 motion-safe:transition-all">
          Generate note
        </button>
      ) : (
        <button onClick={() => handleChangeTemplate()} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10">
          Change Template
        </button>
      )}
      {store.lastTranscript && (
        <button onClick={() => router.push('/transcript')} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10">
          Transcript
        </button>
      )}
      <button onClick={() => setReassignOpen(true)} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10">
        Reassign
      </button>
      {store.lastTranscript && store.lastChosenTemplate && (
        <button onClick={() => setManualOpen(true)} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10">
          Manual AI
        </button>
      )}
    </>
  )

  return (
    <div className="h-full overflow-hidden relative">

      {/* Letter toast */}
      {letterToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-[var(--r)] bg-[var(--text)] text-white text-xs font-medium shadow-lg">
          {letterToast}
        </div>
      )}

      {/* Letter mode bar — floats below the header. The layout controls (Font/
          Spacing/Margin/Sig) used to sit absolutely-centred over this same row,
          which collided with the label and action buttons on narrow screens.
          They now live in a second row shown only when expanded. */}
      {isLetterMode && (
        <div
          data-glass
          className="ln-glass ln-glass-note absolute left-4 right-4 z-20 flex flex-col px-3 py-2 text-white text-sm"
          style={{ top: barTop, borderRadius: 20, boxShadow: '0 4px 16px rgba(14,159,110,0.25)' }}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {letterType === 'referral' ? 'Referral Letter'
                : letterType === 'records' ? 'Records Request'
                : 'Free Text Letter'}
            </span>
            <button
              onClick={() => setLetterBarExpanded(v => !v)}
              aria-label={letterBarExpanded ? 'Collapse layout controls' : 'Expand layout controls'}
              aria-pressed={letterBarExpanded}
              className={`w-6 h-6 flex items-center justify-center rounded-full border motion-safe:transition-all shrink-0 ${
                letterBarExpanded ? 'bg-white text-[var(--blue)] border-white' : 'bg-white/15 border-white/40 text-white'
              }`}
              style={{ transform: letterBarExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transitionDuration: '200ms' }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                onClick={handleLetterPDF}
                className="text-xs bg-white text-[var(--blue)] font-semibold px-3 py-1.5 rounded-[var(--r)] motion-safe:active:scale-95 motion-safe:transition-transform">
                Download PDF
              </button>
              <button
                onClick={handleLetterEmail}
                className="text-xs bg-[#10b981] text-white font-semibold px-3 py-1.5 rounded-[var(--r)] border border-white/50 motion-safe:active:scale-95 motion-safe:transition-transform">
                Email
              </button>
            </div>
          </div>

          {letterBarExpanded && (
            <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-white/20">
              <button
                onClick={() => handleChangeTemplate('letters')}
                className="text-white/80 hover:text-white text-xs px-2 py-1 rounded border border-white/40 hover:bg-white/10 motion-safe:transition-colors">
                Change
              </button>
              <LayoutField label="Font" suffix="pt" value={fontSizeDraft} min={8} max={14} step={0.5}
                onChange={v => { setFontSizeDraft(v); layoutTouchedRef.current = true }} />
              <LayoutField label="Spacing" value={lineSpacingDraft} min={1} max={2} step={0.05}
                onChange={v => { setLineSpacingDraft(v); layoutTouchedRef.current = true }} />
              <LayoutField label="Margin" suffix="mm" value={marginDraft} min={8} max={35} step={1}
                onChange={v => { setMarginDraft(v); layoutTouchedRef.current = true }} />
              {profile?.signatureUrl && (
                <LayoutField label="Sig" suffix="%" value={sigScaleDraft} min={40} max={250} step={5}
                  onChange={v => { setSigScaleDraft(v); layoutTouchedRef.current = true }} />
              )}
              {!layoutAtDefault && (
                <button
                  onClick={handleResetLetterLayout}
                  title="Reset font, spacing, margin and signature size to their defaults"
                  className="text-xs border border-white/40 text-white/80 hover:text-white px-2 py-1 rounded-md
                             hover:bg-white/10 motion-safe:active:scale-95 motion-safe:transition-colors">
                  Reset
                </button>
              )}
              {layoutDirty && (
                <button
                  onClick={handleSaveLetterLayout}
                  disabled={savingLayout}
                  className="text-xs border border-white/50 text-white px-2 py-1 rounded-md font-medium
                             hover:bg-white/10 disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-colors">
                  {savingLayout ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Current note bar — floats below the header. Same collapsible pattern
          as the letter bar: a long patient name used to fight the action
          buttons for space on one row, so the actions now live in a second
          row shown only when expanded. */}
      {!isLetterMode && (store.currentNoteId || isGenerating) && (
        <div
          data-glass
          className={`ln-glass ln-glass-note absolute left-4 right-4 z-20 flex flex-col px-4 py-2 text-white text-sm
            ${isGenerating ? 'animate-pulse' : ''}`}
          style={{
            top: barTop,
            borderRadius: 20,
            boxShadow: '0 4px 16px rgba(14,159,110,0.25)',
          }}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isGenerating ? (
                <div className="flex items-center justify-center rounded-full bg-white/25 px-4 h-7 animate-[shimmer_1.5s_infinite] motion-reduce:animate-none min-w-0">
                  <span className="text-xs text-white font-medium truncate max-w-[260px]">
                    {generationStatus ?? 'Preparing…'}
                  </span>
                </div>
              ) : (
                <>
                  <span className="font-medium truncate min-w-0">
                    {fields.patient || 'No patient'} · {fields.date || '-'}
                  </span>
                  {sessionStats && (
                    <div className="hidden sm:flex items-center gap-1.5 text-xs text-white/60 shrink-0 ml-1">
                      <span>{formatDuration(sessionStats.durationSeconds)}</span>
                      <span className="text-white/30">·</span>
                      <span>{sessionStats.wordCount.toLocaleString()}w</span>
                      <span className="text-white/30">·</span>
                      <span>{sessionStats.wpm} wpm</span>
                    </div>
                  )}
                  {isSaving && (
                    <span className="text-xs text-white/60 ml-2 shrink-0">Saving...</span>
                  )}
                </>
              )}
            </div>
            {/* Desktop: actions sit inline on the header row (in the free space
                to the right of the patient name) — no second line, no toggle. */}
            {!isGenerating && (
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {noteActionButtons}
              </div>
            )}
            {/* Mobile: a chevron toggles the collapsible second row below. */}
            {!isGenerating && (
              <button
                onClick={() => setNoteBarExpanded(v => !v)}
                aria-label={noteBarExpanded ? 'Collapse actions' : 'Expand actions'}
                aria-pressed={noteBarExpanded}
                className={`sm:hidden w-6 h-6 flex items-center justify-center rounded-full border motion-safe:transition-all shrink-0 ${
                  noteBarExpanded ? 'bg-white text-[var(--blue)] border-white' : 'bg-white/15 border-white/40 text-white'
                }`}
                style={{ transform: noteBarExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transitionDuration: '200ms' }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>

          {/* Mobile only: collapsible second row, revealed by the chevron.
              Never shows on desktop (sm:hidden) — the actions are inline above. */}
          {!isGenerating && (
            <div className={`${noteBarExpanded ? 'flex' : 'hidden'} sm:hidden flex-wrap items-center gap-2 mt-2 pt-2 border-t border-white/20`}>
              {noteActionButtons}
            </div>
          )}
        </div>
      )}

      {/* Generation error — floats below bars */}
      {generationError && (
        <div className="absolute left-4 right-4 z-20 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-[var(--danger)] flex items-center justify-between gap-2"
             style={{ top: errorTop }}>
          <span>{generationError}</span>
          <div className="flex items-center gap-2 shrink-0">
            {store.lastTranscript && store.lastChosenTemplate && (
              <button onClick={() => setManualOpen(true)} className="text-xs font-medium underline whitespace-nowrap">Generate manually</button>
            )}
            <button onClick={() => setGenerationError(null)} className="text-xs underline">Dismiss</button>
          </div>
        </div>
      )}


      {/* Form — fills the tab content area; contentPt pushes the first item below the floating bars */}
      <div
        ref={formScrollRef}
        className={`absolute inset-0 overflow-y-auto scrollbar-none px-4 ${fieldFocused ? '' : 'pb-tabbar'}`}
        style={{ paddingTop: contentPt }}
        onFocus={handleFormFocus}
        onBlur={handleFormBlur}
        onKeyDown={handleFormKeyDown}
      >
        <div className="max-w-lg mx-auto space-y-4 pb-10">

            {store.incompleteTranscript && !isLetterMode && (
              <div className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2.5 text-xs text-amber-900 flex items-start justify-between gap-2">
                <span>
                  <strong>Incomplete information.</strong> This note was generated from a transcript without the patient details step — patient name, age and gender were not entered. Review the note and complete the patient fields before finalising. The note won&apos;t be saved until a patient name is added.
                </span>
                <button onClick={() => store.setIncompleteTranscript(false)} className="text-xs underline shrink-0">Dismiss</button>
              </div>
            )}

            {/* Letter mode fields */}
            {isLetterMode && (
              <div className="space-y-4">
                {/* Common fields */}
                <div className="space-y-3">
                  <div className="text-xs font-medium text-[var(--text3)] mb-3">{letterCommonFields.letterDate}</div>
                  <div className="space-y-3">
                  <Input
                    label={letterType === 'freetext' ? 'Subject' : 'Patient name'}
                    value={letterCommonFields.patientName}
                    onChange={e => store.setLetterCommonFields({ patientName: e.target.value })}
                  />
                  {letterType !== 'freetext' && (
                    <Input
                      label="Date of birth (DD/MM/YYYY)"
                      value={letterCommonFields.dob}
                      onChange={e => store.setLetterCommonFields({ dob: autoFormatDate(e.target.value) })}
                      placeholder="DD/MM/YYYY"
                    />
                  )}
                  <Input
                    label="To (recipient name or organisation)"
                    value={letterCommonFields.recipientName}
                    onChange={e => store.setLetterCommonFields({ recipientName: e.target.value })}
                  />
                  <div>
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">Recipient address (optional)</label>
                    <div className="flex gap-2 items-start">
                      <textarea
                        rows={2}
                        value={letterCommonFields.recipientAddress}
                        onChange={e => store.setLetterCommonFields({ recipientAddress: e.target.value })}
                        placeholder="e.g. 79 High St, Wodonga VIC 3690"
                        className="w-0 flex-1 rounded-[var(--r)] border border-[var(--border)] bg-white px-3 py-2 text-sm
                                   text-[var(--text)] placeholder:text-[var(--text3)] outline-none
                                   focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 resize-none"
                      />
                      <div className="flex flex-row gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleSearchAddress}
                          disabled={addrLoading}
                          title="Look up address"
                          aria-label="Look up address"
                          className="w-9 h-9 rounded-[var(--r)] border border-[var(--border)] bg-white flex items-center justify-center
                                     text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)] disabled:opacity-50
                                     motion-safe:transition-colors motion-safe:active:scale-95"
                        >
                          {addrLoading ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" className="animate-spin" aria-hidden>
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeOpacity="0.25"/>
                              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                              <circle cx="12" cy="10" r="3"/>
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handlePasteAddress}
                          title="Paste address from clipboard"
                          aria-label="Paste address from clipboard"
                          className="w-9 h-9 rounded-[var(--r)] border border-[var(--border)] bg-white flex items-center justify-center
                                     text-[var(--text2)] hover:border-[var(--blue)] hover:text-[var(--blue)]
                                     motion-safe:transition-colors motion-safe:active:scale-95"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="9" y="2" width="6" height="4" rx="1"/>
                            <path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Address suggestions */}
                    {addrOpen && (
                      <div className="mt-2 rounded-[var(--r)] border border-[var(--border)] bg-white overflow-hidden"
                        style={{ boxShadow: '0 2px 8px rgba(15,23,42,.08)' }}>
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)] bg-[var(--bg)]">
                          <span className="text-[11px] font-medium text-[var(--text3)]">
                            {addrLoading ? 'Searching…' : 'Select an address'}
                          </span>
                          <button type="button" onClick={() => setAddrOpen(false)} aria-label="Close"
                            className="text-[var(--text3)] hover:text-[var(--text)] text-xs">✕</button>
                        </div>
                        {addrLoading ? (
                          <div className="px-3 py-3 text-xs text-[var(--text3)]">Looking up addresses…</div>
                        ) : addrSuggestions.length > 0 ? (
                          <ul className="max-h-56 overflow-y-auto">
                            {addrSuggestions.map((s, i) => (
                              <li key={i}>
                                <button
                                  type="button"
                                  onClick={() => selectAddress(s.value)}
                                  className="w-full text-left px-3 py-2 text-xs text-[var(--text)]
                                             hover:bg-[var(--blue-lt)] motion-safe:transition-colors
                                             border-b border-[var(--border)] last:border-0"
                                >
                                  {s.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="px-3 py-3 text-xs text-[var(--text3)]">
                            No matches found. Many private clinics aren&apos;t listed — open Google Maps below to find the exact address.
                          </div>
                        )}
                        {/* Persistent Google Maps fallback — OSM often returns only a
                            suburb-level result for private clinics, so always let the
                            user jump to Maps for the precise street address. */}
                        {!addrLoading && (
                          <button
                            type="button"
                            onClick={openInMaps}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium
                                       text-[var(--blue)] bg-[var(--blue-lt)] border-t border-[var(--border)]
                                       hover:brightness-95 motion-safe:transition-[filter] motion-safe:active:scale-[0.99]"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                              <circle cx="12" cy="10" r="3"/>
                            </svg>
                            Open in Google Maps
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  </div>
                </div>

                {/* Referral fields */}
                {letterType === 'referral' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">Admission unit</label>
                      <input
                        list="admission-units"
                        value={referralFields.admissionUnit}
                        onChange={e => store.setReferralFields({ admissionUnit: e.target.value })}
                        placeholder="e.g. Psychiatric Unit"
                        className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10"
                      />
                      <datalist id="admission-units">
                        {ADMISSION_UNITS.map(u => <option key={u} value={u} />)}
                      </datalist>
                    </div>
                    <Input
                      label="Referring doctor name"
                      value={referralFields.doctorName}
                      onChange={e => store.setReferralFields({ doctorName: e.target.value })}
                    />
                    <div>
                      <label className="block text-xs font-medium text-[var(--text)] mb-1">Gender</label>
                      <select
                        value={referralFields.gender}
                        onChange={e => store.setReferralFields({ gender: e.target.value as 'male' | 'female' | '' })}
                        className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--blue)]">
                        <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="">Other / Not specified</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Admission date start (DD/MM/YYYY)"
                        value={referralFields.admissionDateStart}
                        onChange={e => store.setReferralFields({ admissionDateStart: autoFormatDate(e.target.value) })}
                        placeholder="DD/MM/YYYY"
                      />
                      <Input
                        label="Admission date end (DD/MM/YYYY)"
                        value={referralFields.admissionDateEnd}
                        onChange={e => store.setReferralFields({ admissionDateEnd: autoFormatDate(e.target.value) })}
                        placeholder="DD/MM/YYYY"
                      />
                    </div>
                    <Textarea
                      label="Presenting complaint"
                      rows={2}
                      autoResize
                      value={referralFields.presentingComplaint}
                      onChange={e => store.setReferralFields({ presentingComplaint: e.target.value })}
                    />
                    <Textarea
                      label="Second paragraph (optional)"
                      rows={3}
                      autoResize
                      value={referralFields.secondParagraph}
                      onChange={e => store.setReferralFields({ secondParagraph: e.target.value })}
                    />
                    <Textarea
                      label="Reason for referral"
                      rows={2}
                      autoResize
                      value={referralFields.referralReason}
                      onChange={e => store.setReferralFields({ referralReason: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={referralFields.dischargeSummaryAttached}
                        onChange={e => store.setReferralFields({ dischargeSummaryAttached: e.target.checked })}
                        className="accent-[var(--blue)]"
                      />
                      Discharge summary attached
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={referralFields.showPastMedicalHistory}
                        onChange={e => store.setReferralFields({ showPastMedicalHistory: e.target.checked })}
                        className="accent-[var(--blue)]"
                      />
                      Include past medical history
                    </label>
                    {referralFields.showPastMedicalHistory && (
                      <Textarea
                        label="Past Medical History"
                        rows={3}
                        autoResize
                        value={referralFields.pastMedicalHistory}
                        onChange={e => store.setReferralFields({ pastMedicalHistory: e.target.value })}
                      />
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={referralFields.showMedicationList}
                        onChange={e => store.setReferralFields({ showMedicationList: e.target.checked })}
                        className="accent-[var(--blue)]"
                      />
                      Include medication list
                    </label>
                    {referralFields.showMedicationList && (
                      <Textarea
                        label="Medication List"
                        rows={3}
                        autoResize
                        value={referralFields.medicationList}
                        onChange={e => store.setReferralFields({ medicationList: e.target.value })}
                      />
                    )}
                  </div>
                )}

                {/* Records fields */}
                {letterType === 'records' && (
                  <div className="space-y-3">
                    <Input
                      label="Previous provider / location"
                      value={recordsFields.recordsLocation}
                      onChange={e => store.setRecordsFields({ recordsLocation: e.target.value })}
                    />
                    <Textarea
                      label="Additional paragraph (optional)"
                      rows={3}
                      autoResize
                      value={recordsFields.secondParagraphRecords}
                      onChange={e => store.setRecordsFields({ secondParagraphRecords: e.target.value })}
                    />
                  </div>
                )}

                {/* Freetext fields */}
                {letterType === 'freetext' && (
                  <div>
                    <Textarea
                      label="Letter body"
                      rows={12}
                      autoResize
                      value={freetextFields.freeTextContent}
                      onChange={e => store.setFreetextFields({ freeTextContent: e.target.value })}
                      placeholder="Write your letter content here…"
                    />
                  </div>
                )}

                {/* AI generate from transcript */}
                {store.lastTranscript && (
                  <button
                    onClick={handleGenerateFromTranscript}
                    disabled={isGeneratingLetter}
                    className="w-full text-xs bg-[var(--blue)] text-white rounded-[var(--r)] py-2.5 font-medium disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform">
                    {isGeneratingLetter ? 'Generating…' : '✦ Generate from transcript'}
                  </button>
                )}
              </div>
            )}

            {/* Clinical note fields - hidden in letter mode */}
            {!isLetterMode && <>

            {/* Header */}
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold text-[var(--text)]">Edit note</h1>
              <div className="flex items-center gap-3">
                {saveStatus === 'saving' && <span className="text-xs text-[var(--text3)]">Saving…</span>}
                {saveStatus === 'saved' && <span className="text-xs text-[var(--green)]">Saved</span>}
                {!store.currentNoteId && (
                  <Button variant="ghost" size="sm" onClick={handleNewNote}>New note</Button>
                )}
              </div>
            </div>

            {/* Patient + Reg */}
            <div className="grid grid-cols-2 gap-3" data-field="patient">
              {/* Patient with autocomplete */}
              <div className="relative">
                <Input
                  label="Patient"
                  value={fields.patient ?? ''}
                  onChange={e => handlePatientInput(e.target.value)}
                  onFocus={() => setPatientDropdownOpen(true)}
                  onBlur={() => { setTimeout(() => setPatientDropdownOpen(false), 200); handleFieldBlur('patient') }}
                  autoComplete="off"
                  className={saveFlashFields.has('patient') ? 'save-flash' : ''}
                />
                {visitCount !== null && (
                  <span className="text-xs text-[var(--text3)] mt-1 inline-block">
                    {visitCount} previous visit{visitCount !== 1 ? 's' : ''}
                  </span>
                )}
                {patientDropdownOpen && patientMatches.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 bg-white border border-[var(--border)] rounded-[var(--r)] shadow-lg max-h-48 overflow-y-auto mt-1">
                    {patientMatches.map(p => (
                      <button
                        key={p.name}
                        type="button"
                        onMouseDown={() => handleSelectPatient(p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg)] flex items-center justify-between border-b border-[var(--border)] last:border-0"
                      >
                        <span className="text-[var(--text)]">{p.name}</span>
                        <span className="text-xs text-[var(--text3)]">{p.reg}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Reg number with validation */}
              <Input
                label="Registration Number"
                value={fields.reg_number ?? ''}
                onChange={e => setField('reg_number', e.target.value)}
                onBlur={() => handleFieldBlur('reg_number')}
                className={[
                  saveFlashFields.has('reg_number') ? 'save-flash' : '',
                  regStatus === 'valid' ? 'border-green-400' :
                  regStatus === 'invalid' ? 'border-red-400' : '',
                ].filter(Boolean).join(' ')}
                hint={regStatus === 'invalid' ? `Expected format: ${activeWorkplace?.regTemplate ?? ''}` : undefined}
              />
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3" data-field="date">
              <DatePicker
                label="Date"
                value={fields.date ?? ''}
                onChange={v => { setField('date', v); handleFieldBlur('date') }}
              />
              <TimePicker
                label="Time"
                value={fields.time ?? ''}
                onChange={v => { setField('time', v); handleFieldBlur('time') }}
              />
            </div>

            {/* Clinician + Session number */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Clinician"
                value={fields.clinician ?? ''}
                onChange={e => setField('clinician', e.target.value)}
                onBlur={() => handleFieldBlur('clinician')}
                className={saveFlashFields.has('clinician') ? 'save-flash' : ''}
              />
              <Input
                label="Session number"
                value={fields.session_number ?? ''}
                onChange={e => setField('session_number', e.target.value)}
                onBlur={() => handleFieldBlur('session_number')}
                className={saveFlashFields.has('session_number') ? 'save-flash' : ''}
              />
            </div>

            <Input
              label="Attendance"
              value={fields.attendance ?? ''}
              onChange={e => setField('attendance', e.target.value)}
              onBlur={() => handleFieldBlur('attendance')}
              className={saveFlashFields.has('attendance') ? 'save-flash' : ''}
            />
            {renderDivider('after-attendance')}
            <div data-field="diagnosis">
              <Textarea
                label="Diagnosis"
                rows={3}
                autoResize
                value={fields.diagnosis ?? ''}
                onChange={e => setField('diagnosis', e.target.value)}
                onBlur={() => handleFieldBlur('diagnosis')}
                className={saveFlashFields.has('diagnosis') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-diagnosis')}
            <div data-field="presentation">
              <Textarea
                label="Presentation"
                rows={5}
                autoResize
                value={fields.presentation ?? ''}
                onChange={e => setField('presentation', e.target.value)}
                onBlur={() => handleFieldBlur('presentation')}
                className={saveFlashFields.has('presentation') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-presentation')}
            <div data-field="history">
              <Textarea
                label="History"
                rows={5}
                autoResize
                value={fields.history ?? ''}
                onChange={e => setField('history', e.target.value)}
                onBlur={() => handleFieldBlur('history')}
                className={saveFlashFields.has('history') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-history')}
            <div data-field="medications">
              <Textarea
                label="Medications"
                rows={3}
                autoResize
                value={fields.medications ?? ''}
                onChange={e => setField('medications', e.target.value)}
                onBlur={() => handleFieldBlur('medications')}
                className={saveFlashFields.has('medications') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-medications')}
            <div data-field="mse">
              <Textarea
                label="Mental Status Examination"
                rows={5}
                autoResize
                value={fields.mse ?? ''}
                onChange={e => setField('mse', e.target.value)}
                onBlur={() => handleFieldBlur('mse')}
                className={saveFlashFields.has('mse') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-mse')}
            <div data-field="content">
              <Textarea
                label="Session Content"
                rows={8}
                autoResize
                value={fields.content ?? ''}
                onChange={e => setField('content', e.target.value)}
                onBlur={() => handleFieldBlur('content')}
                onKeyDown={e => handleListKeyDown(e, 'content')}
                className={saveFlashFields.has('content') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-content')}
            <div data-field="scales">
              <Textarea
                label="Scales"
                rows={3}
                autoResize
                value={fields.scales ?? ''}
                onChange={e => setField('scales', e.target.value)}
                onBlur={() => handleFieldBlur('scales')}
                onKeyDown={e => handleListKeyDown(e, 'scales')}
                className={saveFlashFields.has('scales') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-scales')}
            <div data-field="risk">
              <Textarea
                label="Risk"
                rows={4}
                autoResize
                value={fields.risk ?? ''}
                onChange={e => setField('risk', e.target.value)}
                onBlur={() => handleFieldBlur('risk')}
                onKeyDown={e => handleListKeyDown(e, 'risk')}
                className={saveFlashFields.has('risk') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-risk')}
            <div data-field="referrals">
              <Textarea
                label="Referrals"
                rows={3}
                autoResize
                value={fields.referrals ?? ''}
                onChange={e => setField('referrals', e.target.value)}
                onBlur={() => handleFieldBlur('referrals')}
                onKeyDown={e => handleListKeyDown(e, 'referrals')}
                className={saveFlashFields.has('referrals') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-referrals')}
            <div data-field="summary">
              <Textarea
                label="Summary"
                rows={5}
                autoResize
                value={fields.summary ?? ''}
                onChange={e => setField('summary', e.target.value)}
                onBlur={() => handleFieldBlur('summary')}
                className={saveFlashFields.has('summary') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-summary')}
            <div data-field="nextsteps">
              <Textarea
                label="Next Steps"
                rows={3}
                autoResize
                value={fields.nextsteps ?? ''}
                onChange={e => setField('nextsteps', e.target.value)}
                onBlur={() => handleFieldBlur('nextsteps')}
                onKeyDown={e => handleListKeyDown(e, 'nextsteps')}
                className={saveFlashFields.has('nextsteps') ? 'save-flash' : ''}
              />
            </div>
            {renderDivider('after-nextsteps')}

            {/* Raw transcript collapsible */}
            {store.lastTranscript && (
              <div className="mt-6 border border-[var(--border)] rounded-[var(--r)] overflow-hidden">
                <button
                  onClick={() => setTranscriptExpanded(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-[var(--bg)] text-sm font-medium text-[var(--text2)] hover:bg-[var(--border)]"
                >
                  <span>Raw Transcript · {store.lastTranscript.trim().split(/\s+/).length} words</span>
                  <span>{transcriptExpanded ? '▲' : '▼'}</span>
                </button>
                <div className={`relative px-4 py-3 text-sm text-[var(--text2)] leading-relaxed ${!transcriptExpanded ? 'max-h-24 overflow-hidden' : ''}`}>
                  <p className="whitespace-pre-wrap">{store.lastTranscript}</p>
                  {!transcriptExpanded && (
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent" />
                  )}
                </div>
              </div>
            )}

            </> /* end !isLetterMode */}
        </div>
      </div>

      <TemplatePicker
        open={changeTemplateOpen}
        onSelect={handleTemplateChange}
        onSelectLetter={handleSelectLetterType}
        onCancel={() => setChangeTemplateOpen(false)}
        defaultTab={changeTemplateDefaultTab}
      />
      <ReassignModal
        open={reassignOpen}
        allNotes={allNotes}
        onConfirm={handleReassign}
        onClose={() => setReassignOpen(false)}
      />
      <ManualGenerateModal
        open={manualOpen}
        buildPrompt={buildManualPrompt}
        onApply={applyManualResult}
        onClose={() => setManualOpen(false)}
      />
    </div>
  )
}

// Compact number stepper used in the letter-mode toolbar.
// Uses local string state while typing; commits on blur or ±click so the layout
// never jumps. Custom +/− buttons replace the invisible native spinner arrows.
function LayoutField({
  label, value, min, max, step, suffix, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (v: number) => void
}) {
  const decimals = step < 1 ? (String(step).split('.')[1]?.length ?? 0) : 0
  const fmt = (n: number) => decimals > 0 ? n.toFixed(decimals) : String(n)

  const [localVal, setLocalVal] = useState(() => fmt(value))
  const prevExtRef = useRef(value)

  useEffect(() => {
    if (value !== prevExtRef.current) {
      prevExtRef.current = value
      setLocalVal(fmt(value))
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  function commit(raw: string) {
    let v = parseFloat(raw)
    if (Number.isNaN(v)) v = value
    v = parseFloat(Math.min(max, Math.max(min, v)).toFixed(decimals))
    prevExtRef.current = v
    setLocalVal(fmt(v))
    onChange(v)
  }

  function nudge(dir: 1 | -1) {
    const v = parseFloat((Math.min(max, Math.max(min, value + dir * step))).toFixed(decimals))
    prevExtRef.current = v
    setLocalVal(fmt(v))
    onChange(v)
  }

  return (
    <label className="flex items-center gap-1 text-[11px] text-white/90 select-none">
      <span className="whitespace-nowrap">{label}</span>
      <div className="flex items-center rounded-xl border border-white/40 overflow-hidden">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => nudge(-1)}
          className="px-1.5 py-0.5 bg-white/15 hover:bg-white/25 text-white text-sm font-bold leading-none motion-safe:active:scale-95 motion-safe:transition-transform shrink-0"
          aria-label={`Decrease ${label}`}
        >−</button>
        <input
          type="text"
          inputMode="decimal"
          value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.currentTarget.blur(); commit(e.currentTarget.value) }
            if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1) }
            if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1) }
          }}
          className="w-9 bg-white text-[var(--text)] text-xs text-center px-0.5 py-1 outline-none border-0 focus:ring-0"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => nudge(1)}
          className="px-1.5 py-0.5 bg-white/15 hover:bg-white/25 text-white text-sm font-bold leading-none motion-safe:active:scale-95 motion-safe:transition-transform shrink-0"
          aria-label={`Increase ${label}`}
        >+</button>
      </div>
      {suffix && <span className="text-white/70">{suffix}</span>}
    </label>
  )
}
