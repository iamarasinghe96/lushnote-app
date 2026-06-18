'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { saveNote, updateNote, listNotes, getNote } from '@/lib/firestore/notes'
import { savePatientProfile } from '@/lib/firestore/patients'
import { updateProfile } from '@/lib/firestore/profiles'
import { buildPreviewHTML, buildLetterPreviewHTML, buildTemplatePrompt, formatDateForLetter, calculateAgeFromDOB } from '@/lib/utils'
import { getPersonalisationPrefix } from '@/lib/personalisation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import TimePicker from '@/components/ui/TimePicker'
import TemplatePicker from '@/components/modals/TemplatePicker'
import ReassignModal from '@/components/modals/ReassignModal'
import type { Note, NoteInput, AnyTemplate, Workplace, LetterType, CustomTemplateField, CustomTemplate } from '@/types'

const FIELD_ORDER = [
  'patient', 'date', 'diagnosis', 'presentation', 'history', 'medications', 'mse',
  'content', 'scales', 'risk', 'referrals', 'summary', 'nextsteps',
] as const

const FIELD_ANIM_LABEL: Record<string, string> = {
  patient: 'Patient', date: 'Date', diagnosis: 'Diagnosis',
  presentation: 'Presentation', history: 'History', medications: 'Medications',
  mse: 'Mental State Exam', content: 'Session Content', scales: 'Scales',
  risk: 'Risk', referrals: 'Referrals', summary: 'Summary', nextsteps: 'Next Steps',
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
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
  const bracketRx = /(?:^|\n)\[([a-z]{3,})\][^\n]*\n([\s\S]*?)(?=(?:^|\n)\[[a-z]{3,}\]|$)/g
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
  if (bracketParsed) return out

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
  if (headingParsed) return out

  // Last resort: whole response → content field
  out.content = content.trim()
  return out
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
  const { user, profile } = useAuth()
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
  const [previewHtml, setPreviewHtml] = useState(() => buildPreviewHTML(store.currentNote))
  const [showMobilePreview, setShowMobilePreview] = useState(false)
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [changeTemplateOpen, setChangeTemplateOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false)
  const [visitCount, setVisitCount] = useState<number | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const autoSaveEnabledRef = useRef(true)
  const latestFieldsRef = useRef<Partial<Note>>(store.currentNote)
  const formScrollRef = useRef<HTMLDivElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const scrollSyncLockRef = useRef(false)
  const isAnimatingRef = useRef(false)
  const [currentAnimatingField, setCurrentAnimatingField] = useState<string | null>(null)

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

  useEffect(() => { return () => { mountedRef.current = false } }, [])

  // Bidirectional scroll sync - mirrors scroll position proportionally between both panes
  useEffect(() => {
    const form = formScrollRef.current
    const preview = previewScrollRef.current
    if (!form || !preview) return

    function syncTo(source: HTMLDivElement, target: HTMLDivElement) {
      if (scrollSyncLockRef.current) return
      scrollSyncLockRef.current = true
      const pct = source.scrollTop / (source.scrollHeight - source.clientHeight) || 0
      target.scrollTop = pct * (target.scrollHeight - target.clientHeight)
      requestAnimationFrame(() => { scrollSyncLockRef.current = false })
    }

    const onFormScroll = () => { if (!isAnimatingRef.current) syncTo(form, preview) }
    const onPreviewScroll = () => { if (!isAnimatingRef.current) syncTo(preview, form) }

    form.addEventListener('scroll', onFormScroll, { passive: true })
    preview.addEventListener('scroll', onPreviewScroll, { passive: true })
    return () => {
      form.removeEventListener('scroll', onFormScroll)
      preview.removeEventListener('scroll', onPreviewScroll)
    }
  }, [])

  useEffect(() => {
    const s = storeRef.current
    const noteIdParam = searchParams.get('noteId')
    if (s.pendingAnimation) {
      // In-progress generation takes priority over any ?noteId= in the URL
      s.setPendingAnimation(false)
      const known: Partial<Note> = {
        patient: (s.currentNote as Record<string, string>)['patient'] || '',
        reg_number: (s.currentNote as Record<string, string>)['reg_number'] || '',
      }
      latestFieldsRef.current = known
      setFields(known)
      runPendingGeneration()
    } else if (noteIdParam && noteIdParam !== s.currentNoteId) {
      // Navigated here from History tab (or direct URL) with ?noteId=
      loadNote(noteIdParam)
    } else {
      latestFieldsRef.current = s.currentNote
      setFields(s.currentNote)
      setPreviewHtml(buildPreviewHTML(s.currentNote))
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
    setPreviewHtml(buildPreviewHTML(noteFields))
    store.setCurrentNote(noteFields)
    store.setCurrentNoteId(noteId)
    if (note.transcript) {
      store.setLastTranscript(note.transcript)
      store.setLastTranscriptMode((note.transcriptMode as Parameters<typeof store.setLastTranscriptMode>[0]) ?? 'paste')
    }
  }

  useEffect(() => {
    if (isLetterMode) return
    const timer = setTimeout(() => setPreviewHtml(buildPreviewHTML(fields)), 200)
    return () => clearTimeout(timer)
  }, [fields, isLetterMode])

  useEffect(() => {
    if (!isLetterMode) return
    const timer = setTimeout(() => {
      const html = buildLetterPreviewHTML({
        letterType: letterType!,
        common: letterCommonFields,
        referral: referralFields,
        records: recordsFields,
        freetext: freetextFields,
        letterheadHeaderUrl: null,
        letterheadFooterUrl: null,
        signatureUrl: profile?.signatureUrl ?? null,
        clinicianName: profile?.displayName,
        credentials: profile?.credentials,
      })
      setPreviewHtml(html)
    }, 200)
    return () => clearTimeout(timer)
  }, [isLetterMode, letterType, letterCommonFields, referralFields, recordsFields, freetextFields, profile])

  useEffect(() => {
    if (!letterToast) return
    const t = setTimeout(() => setLetterToast(null), 3500)
    return () => clearTimeout(t)
  }, [letterToast])

  useEffect(() => {
    if (!user) return
    listNotes(user.uid).then(setAllNotes).catch(() => {})
  }, [user?.uid])

  const storeRef = useRef(store)
  storeRef.current = store

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
          transcript:     s.lastTranscript    ?? undefined,
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

  function typewriterField(key: string, value: string): Promise<void> {
    return new Promise(resolve => {
      let i = 0
      setFields(prev => {
        const next = { ...prev, [key]: '' }
        latestFieldsRef.current = next
        return next
      })
      const interval = setInterval(() => {
        i++
        const slice = value.slice(0, i)
        setFields(prev => {
          const next = { ...prev, [key]: slice }
          latestFieldsRef.current = next
          return next
        })
        // Keep textarea scrolled to bottom as text arrives
        requestAnimationFrame(() => {
          const ta = formScrollRef.current
            ?.querySelector<HTMLTextAreaElement>(`[data-field="${key}"] textarea`)
          if (ta) ta.scrollTop = ta.scrollHeight
        })
        if (i >= value.length) {
          clearInterval(interval)
          resolve()
        }
      }, 15)
    })
  }

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
        transcript:     s.lastTranscript    ?? undefined,
        transcriptMode: s.lastTranscriptMode,
      }
      if (s.currentNoteId) {
        await updateNote(s.currentNoteId, noteData)
      } else {
        const id = await saveNote(noteData)
        s.setCurrentNoteId(id)
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

  async function animateFields(noteFields: Partial<Note>) {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    autoSaveEnabledRef.current = false
    // Batch all three so there is no blank frame between isGenerating→isAnimating
    setIsGenerating(false)
    setGenerationStatus(null)
    setIsAnimating(true)
    isAnimatingRef.current = true

    if (reduced) {
      setFields(prev => {
        const next = { ...prev, ...noteFields }
        latestFieldsRef.current = next
        return next
      })
      setCurrentAnimatingField(null)
      setIsAnimating(false)
      isAnimatingRef.current = false
      autoSaveEnabledRef.current = true
      return
    }

    for (const key of FIELD_ORDER) {
      if (!mountedRef.current) break
      const value = (noteFields as Record<string, string>)[key]
      if (!value || typeof value !== 'string') continue

      setCurrentAnimatingField(key)
      // Form pane: [data-field] divs are always in the DOM - scroll immediately
      formScrollRef.current?.querySelector(`[data-field="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

      await typewriterField(key, value)

      if (!mountedRef.current) break

      // Force preview HTML update now (bypasses the 200ms debounced useEffect so the
      // preview section element exists in the DOM before we try to scrollIntoView it)
      setPreviewHtml(buildPreviewHTML(latestFieldsRef.current))
      // Double-rAF: first frame commits React's state update, second frame the DOM is painted
      await new Promise<void>(r => requestAnimationFrame(() => { requestAnimationFrame(() => r()) }))

      previewScrollRef.current?.querySelector(`[data-field="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    if (mountedRef.current) {
      setCurrentAnimatingField(null)
      setIsAnimating(false)
      isAnimatingRef.current = false
      autoSaveEnabledRef.current = true
      // Use direct scrollTop (not scrollTo smooth) inside a delay so it fires after
      // the debounced preview HTML update (which would otherwise cancel a smooth scroll)
      const form = formScrollRef.current
      const preview = previewScrollRef.current
      setTimeout(() => {
        if (form) form.scrollTop = 0
        if (preview) preview.scrollTop = 0
      }, 250)
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

  function handleChangeTemplate() { setChangeTemplateOpen(true) }

  function handleTemplateChange(newTemplate: AnyTemplate, noteLength?: string) {
    setChangeTemplateOpen(false)
    if (!window.confirm(`Regenerate note with "${newTemplate.title}"?`)) return
    if (noteLength) store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
    runGeneration(store.lastTranscript ?? '', newTemplate)
  }

  async function runPendingGeneration() {
    const s = storeRef.current
    const template = s.lastChosenTemplate
    const transcript = s.lastTranscript || ''
    if (!template || !user) return

    // Auto-fill date and clinician immediately
    const now = new Date()
    const dd = String(now.getDate()).padStart(2, '0')
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const yyyy = now.getFullYear()
    const dateStr = `${dd}/${mm}/${yyyy}`

    setFields(prev => {
      const next = { ...prev, date: dateStr, clinician: profile?.displayName ?? '' }
      latestFieldsRef.current = next
      return next
    })

    autoSaveEnabledRef.current = false
    setIsGenerating(true)

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
      const groqKey = sessionStorage.getItem('groq_api_key')
      if (groqKey) headers['x-groq-key'] = groqKey

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transcript, templatePrompt: buildTemplatePrompt(template), systemPrompt, uid: user.uid }),
      })

      statusTimers.forEach(clearTimeout)
      if (!mountedRef.current) return

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Generation failed')
      }

      const data = await res.json() as { content: string; provider?: string; groqTokensUsed?: number }
      if (!data.content?.trim()) throw new Error('AI returned empty response. Please try again.')

      if (data.provider === 'groq') {
        setLetterToast('Note generated using Groq - Gemini daily limit reached')
      }

      const noteFields = parseGeneratedContent(data.content)
      await animateFields(noteFields)

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
      if (!mountedRef.current) return
      setIsGenerating(false)
      setGenerationStatus(null)
      autoSaveEnabledRef.current = true
      setGenerationError(err instanceof Error ? err.message : 'Generation failed')
    }
  }

  async function runGeneration(transcript: string, template: AnyTemplate) {
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
      const groqKey = sessionStorage.getItem('groq_api_key')
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transcript, templatePrompt: buildTemplatePrompt(template), systemPrompt, uid: user!.uid }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Generation failed')
      }
      const data = await res.json() as { content: string }
      clearInterval(statusTimer)
      if (!mountedRef.current) return
      const noteFields = parseGeneratedContent(data.content)
      await animateFields(noteFields)
      if (mountedRef.current) {
        storeRef.current.setCurrentNote(latestFieldsRef.current)
        await doAutoSave()
      }
    } catch {
      clearInterval(statusTimer)
      setGenerationStatus(null)
      if (mountedRef.current) setIsGenerating(false)
    }
  }

  async function loadImageAsDataURL(url: string): Promise<{ dataUrl: string; w: number; h: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        resolve({ dataUrl: canvas.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight })
      }
      img.onerror = reject
      img.src = url
    })
  }

  async function handleLetterPDF() {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const PW = 210, PH = 297, ML = 20, MR = 20, CW = PW - ML - MR
    const LH = 5.5, PS = 3.5
    let y = 20

    const footerH = 10
    const maxY = PH - footerH - 5

    const write = (text: string, bold = false, size = 11) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      doc.splitTextToSize(text, CW).forEach((line: string) => {
        if (y + LH > maxY) { doc.addPage(); y = 20 }
        doc.text(line, ML, y)
        y += LH
      })
    }
    const nl = (n = 1) => { y += PS * n }

    write(letterCommonFields.letterDate || '')
    nl()
    write('To:')
    write(letterCommonFields.recipientName || '[Recipient Name]')
    if (letterCommonFields.recipientAddress) write(letterCommonFields.recipientAddress)
    nl()

    if (letterType !== 'freetext') {
      write(`Re: ${letterCommonFields.patientName || '[Patient Name]'}`, true)
      if (letterCommonFields.dob) write(`DOB: ${letterCommonFields.dob}`, true)
    } else {
      write(`Subject: ${letterCommonFields.patientName || '[Subject]'}`, true)
    }
    nl()

    if (letterType === 'referral') {
      write(`To Dr. ${referralFields.doctorName || '[Doctor Name]'},`)
      nl(0.5)
      write(`I am writing to refer to you ${letterCommonFields.patientName || '[Patient Name]'}, who was admitted to the ${referralFields.admissionUnit || '[Unit]'} from the ${formatDateForLetter(referralFields.admissionDateStart)} to the ${formatDateForLetter(referralFields.admissionDateEnd)}.`)
      nl(0.5)
      const age = calculateAgeFromDOB(letterCommonFields.dob)
      const agePart = age !== null ? `${age} year old ` : ''
      const firstName = (letterCommonFields.patientName || '').split(' ')[0] || 'Patient'
      const title = referralFields.gender === 'male' ? 'Mr.' : referralFields.gender === 'female' ? 'Ms.' : ''
      write(`Thank you for seeing ${title} ${letterCommonFields.patientName || '[Patient Name]'}. ${firstName} is a ${agePart}${referralFields.gender || '[gender]'} who presented with ${referralFields.presentingComplaint || '[presenting complaint]'}.`)
      if (referralFields.secondParagraph) { nl(0.5); write(referralFields.secondParagraph) }
      nl(0.5)
      write(`${referralFields.referralReason || '[reason for referral]'}${referralFields.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`)
      if (referralFields.showPastMedicalHistory && referralFields.pastMedicalHistory) {
        nl(0.5); write('Past Medical History:', true); write(referralFields.pastMedicalHistory)
      }
      if (referralFields.showMedicationList && referralFields.medicationList) {
        nl(0.5); write('Medication List:', true); write(referralFields.medicationList)
      }
      nl(0.5)
      write('Please do not hesitate to contact me if there are any queries regarding this referral.')
    } else if (letterType === 'records') {
      write('To whom it may concern,')
      nl(0.5)
      write(`I am writing to request any correspondence or documentation from their previous visits at ${recordsFields.recordsLocation || '[Location]'}.`)
      if (recordsFields.secondParagraphRecords) { nl(0.5); write(recordsFields.secondParagraphRecords) }
    } else if (letterType === 'freetext') {
      write(freetextFields.freeTextContent || '')
    }

    nl(2)
    write('Kind regards,')
    nl(0.5)

    if (profile?.signatureUrl) {
      try {
        const { dataUrl } = await loadImageAsDataURL(profile.signatureUrl)
        if (y + 18 > maxY) { doc.addPage(); y = 20 }
        doc.addImage(dataUrl, 'PNG', ML, y, 40, 14)
        y += 16
      } catch { nl(2) }
    }

    if (profile?.displayName) write(profile.displayName)
    if (profile?.credentials) write(profile.credentials, false, 10)

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
      const groqKey = sessionStorage.getItem('groq_api_key')
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'letter', letterType, transcript: store.lastTranscript }),
      })
      const data = await res.json() as { letterFields?: Record<string, string>; error?: string }
      if (data.letterFields) {
        if (letterType === 'referral') store.setReferralFields(data.letterFields as Parameters<typeof store.setReferralFields>[0])
        else if (letterType === 'records') store.setRecordsFields(data.letterFields as Parameters<typeof store.setRecordsFields>[0])
        else if (letterType === 'freetext') store.setFreetextFields(data.letterFields as Parameters<typeof store.setFreetextFields>[0])
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

  // ── Custom note field handlers ────────────────────────────────────────────

  function openCustomField(key: string) {
    setCustomFieldOpen(key)
    setCustomLabel('')
    setCustomPrompt('')
    setCustomRaw('')
    setCustomProcessed('')
    setCustomTarget('nextsteps')
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
      const groqKey = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('groq_api_key') : null
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
      const groqKey = sessionStorage.getItem('groq_api_key')
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
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--text)] mb-1">Append to field</label>
                    <select value={customTarget as string} onChange={e => setCustomTarget(e.target.value as keyof Note)}
                      className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--blue)]">
                      {TARGET_NOTE_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
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
          <span className={`text-sm font-bold shrink-0 motion-safe:transition-colors ${isOpen ? 'text-[var(--blue)]' : 'text-[var(--text3)] group-hover:text-[var(--text2)]'}`}>+</span>
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

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Letter toast */}
      {letterToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-[var(--r)] bg-[var(--text)] text-white text-xs font-medium shadow-lg">
          {letterToast}
        </div>
      )}

      {/* Letter mode bar */}
      {isLetterMode && (
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--blue)] text-white text-sm shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { store.resetLetterMode(); router.push('/generate') }}
              className="text-white/70 hover:text-white text-xs flex items-center gap-1 motion-safe:active:scale-95 motion-safe:transition-transform">
              ← Back
            </button>
            <span className="text-white/40">|</span>
            <span className="font-medium text-sm">
              {letterType === 'referral' ? 'Referral Letter'
                : letterType === 'records' ? 'Medical Records Request'
                : 'Free Text Letter'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLetterPDF}
              className="text-xs bg-white text-[var(--blue)] font-semibold px-3 py-1.5 rounded-[var(--r)] motion-safe:active:scale-95 motion-safe:transition-transform">
              Download PDF
            </button>
            <button
              onClick={handleLetterEmail}
              className="text-xs bg-[#10b981] text-white font-semibold px-3 py-1.5 rounded-[var(--r)] motion-safe:active:scale-95 motion-safe:transition-transform">
              Email via Outlook
            </button>
          </div>
        </div>
      )}

      {/* Current note bar */}
      {!isLetterMode && (store.currentNoteId || isAnimating || isGenerating) && (
        <div
          className={`flex items-center justify-between px-4 py-2 text-white text-sm shrink-0 mx-4 mb-1
            ${isGenerating ? 'animate-pulse' : ''}`}
          style={{
            borderRadius: 20,
            background: 'rgba(14,159,110,0.90)',
            backdropFilter: 'blur(8px) saturate(1.5)',
            WebkitBackdropFilter: 'blur(8px) saturate(1.5)',
            border: '1px solid rgba(255,255,255,0.25)',
            boxShadow: '0 4px 16px rgba(14,159,110,0.25), inset 0 1px 0 rgba(255,255,255,0.20)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {(isAnimating || isGenerating) ? (
              <div className="flex items-center justify-center rounded-full bg-white/25 px-4 h-7 animate-[shimmer_1.5s_infinite] motion-reduce:animate-none">
                <span className="text-xs text-white font-medium truncate max-w-[260px]">
                  {isGenerating
                    ? (generationStatus ?? 'Preparing…')
                    : (FIELD_ANIM_LABEL[currentAnimatingField ?? ''] ?? 'Writing note…')}
                </span>
              </div>
            ) : (
              <>
                <span className="font-medium truncate">
                  {fields.patient || 'No patient'} · {fields.date || '-'}
                </span>
                {isSaving && (
                  <span className="text-xs text-white/60 ml-2 shrink-0">Saving...</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handleChangeTemplate} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10">
              Change Template
            </button>
            {store.lastTranscript && (
              <button onClick={() => router.push('/transcript')} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10">
                Transcript
              </button>
            )}
            <button onClick={() => setReassignOpen(true)} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10">
              Reassign
            </button>
            <button onClick={handleNewNote} className="text-white/80 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10 border border-white/30">
              + New Note
            </button>
          </div>
        </div>
      )}

      {/* Generation error */}
      {generationError && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-[var(--danger)] flex items-center justify-between shrink-0">
          <span>{generationError}</span>
          <button onClick={() => setGenerationError(null)} className="ml-2 text-xs underline shrink-0">Dismiss</button>
        </div>
      )}

      {/* Session stats card */}
      {!isLetterMode && sessionStats && !isGenerating && (
        <div className="mx-4 mt-3 p-3 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r)] flex items-center gap-6 shrink-0">
          <div className="text-center">
            <div className="text-lg font-bold text-[var(--text)]">{formatDuration(sessionStats.durationSeconds)}</div>
            <div className="text-xs text-[var(--text3)]">Duration</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-[var(--text)]">{sessionStats.wordCount}</div>
            <div className="text-xs text-[var(--text3)]">Words</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-[var(--text)]">{sessionStats.wpm}</div>
            <div className="text-xs text-[var(--text3)]">WPM</div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[55%_45%] grid-rows-[1fr]">

        {/* LEFT: form */}
        <div ref={formScrollRef} className="overflow-y-auto p-4 min-h-0">
          <div className="max-w-lg mx-auto space-y-4 pb-10">

            {/* Letter mode fields */}
            {isLetterMode && (
              <div className="space-y-4">
                {/* Common fields */}
                <div className="p-3 rounded-[var(--r-lg)]"
                  style={{
                    background: 'rgba(255,255,255,0.75)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                  }}>
                  <div className="text-xs font-medium text-[var(--text3)] mb-3">{letterCommonFields.letterDate}</div>
                  <Input
                    label={letterType === 'freetext' ? 'Subject' : 'Patient name'}
                    value={letterCommonFields.patientName}
                    onChange={e => store.setLetterCommonFields({ patientName: e.target.value })}
                  />
                  {letterType !== 'freetext' && (
                    <Input
                      label="Date of birth (DD/MM/YYYY)"
                      className="mt-3"
                      value={letterCommonFields.dob}
                      onChange={e => store.setLetterCommonFields({ dob: e.target.value })}
                      placeholder="DD/MM/YYYY"
                    />
                  )}
                  <Input
                    label="To (recipient name or organisation)"
                    className="mt-3"
                    value={letterCommonFields.recipientName}
                    onChange={e => store.setLetterCommonFields({ recipientName: e.target.value })}
                  />
                  <Textarea
                    label="Recipient address (optional)"
                    rows={2}
                    className="mt-3"
                    value={letterCommonFields.recipientAddress}
                    onChange={e => store.setLetterCommonFields({ recipientAddress: e.target.value })}
                  />
                </div>

                {/* Referral fields */}
                {letterType === 'referral' && (
                  <div className="p-3 rounded-[var(--r-lg)] space-y-3"
                    style={{
                      background: 'rgba(255,255,255,0.75)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                    }}>
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
                        onChange={e => store.setReferralFields({ admissionDateStart: e.target.value })}
                        placeholder="DD/MM/YYYY"
                      />
                      <Input
                        label="Admission date end (DD/MM/YYYY)"
                        value={referralFields.admissionDateEnd}
                        onChange={e => store.setReferralFields({ admissionDateEnd: e.target.value })}
                        placeholder="DD/MM/YYYY"
                      />
                    </div>
                    <Textarea
                      label="Presenting complaint"
                      rows={2}
                      value={referralFields.presentingComplaint}
                      onChange={e => store.setReferralFields({ presentingComplaint: e.target.value })}
                    />
                    <Textarea
                      label="Second paragraph (optional)"
                      rows={3}
                      value={referralFields.secondParagraph}
                      onChange={e => store.setReferralFields({ secondParagraph: e.target.value })}
                    />
                    <Textarea
                      label="Reason for referral"
                      rows={2}
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
                        value={referralFields.medicationList}
                        onChange={e => store.setReferralFields({ medicationList: e.target.value })}
                      />
                    )}
                  </div>
                )}

                {/* Records fields */}
                {letterType === 'records' && (
                  <div className="p-3 rounded-[var(--r-lg)] space-y-3"
                    style={{
                      background: 'rgba(255,255,255,0.75)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                    }}>
                    <Input
                      label="Previous provider / location"
                      value={recordsFields.recordsLocation}
                      onChange={e => store.setRecordsFields({ recordsLocation: e.target.value })}
                    />
                    <Textarea
                      label="Additional paragraph (optional)"
                      rows={3}
                      value={recordsFields.secondParagraphRecords}
                      onChange={e => store.setRecordsFields({ secondParagraphRecords: e.target.value })}
                    />
                  </div>
                )}

                {/* Freetext fields */}
                {letterType === 'freetext' && (
                  <div className="p-3 rounded-[var(--r-lg)]"
                    style={{
                      background: 'rgba(255,255,255,0.75)',
                      backdropFilter: 'blur(12px)',
                      boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
                    }}>
                    <Textarea
                      label="Letter body"
                      rows={12}
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

        {/* RIGHT: live preview - hidden on mobile unless toggled */}
        <div
          className={`${showMobilePreview ? 'grid' : 'hidden'} md:grid min-h-0 border-l border-[var(--border)]`}
          style={{ gridTemplateRows: 'auto 1fr', background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)' }}
        >
          <div
            className="border-b border-[var(--border)] px-4 py-2"
            style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(12px)' }}
          >
            <span className="text-xs font-semibold text-[var(--text3)] uppercase tracking-wide">Preview</span>
          </div>
          <div
            ref={previewScrollRef}
            className="overflow-y-auto p-4 preview-pane min-h-0"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>

      {/* Mobile preview toggle */}
      <button
        onClick={() => setShowMobilePreview(v => !v)}
        className="md:hidden fixed bottom-20 right-4 z-40 bg-white border border-[var(--border)] rounded-full px-4 py-2 text-xs font-medium text-[var(--text2)] active:scale-95 transition-transform"
        style={{ boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}
      >
        {showMobilePreview ? 'Hide Preview' : 'Preview'}
      </button>

      <TemplatePicker
        open={changeTemplateOpen}
        onSelect={handleTemplateChange}
        onCancel={() => setChangeTemplateOpen(false)}
      />
      <ReassignModal
        open={reassignOpen}
        allNotes={allNotes}
        onConfirm={handleReassign}
        onClose={() => setReassignOpen(false)}
      />
    </div>
  )
}
