'use client'

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore, hydrateLetterFromNote } from '@/hooks/useNoteStore'
import { useKeyboardCloseSafety } from '@/hooks/useKeyboardCloseSafety'
import { saveNote, updateNote, listNotes, getNote } from '@/lib/firestore/notes'
import { savePatientProfile, getPatientProfiles } from '@/lib/firestore/patients'
import { deleteTranscriptDraft } from '@/lib/firestore/transcriptDrafts'
import { getHospitalForm } from '@/lib/firestore/hospitalForms'
import HospitalFormView from '@/components/hospital-form/HospitalFormView'
import { registerReloadGuard } from '@/lib/reloadGuard'
import { updateProfile } from '@/lib/firestore/profiles'
import { buildTemplatePrompt, stripRedundantSectionLabel, autoSessionTime, getGroqKey, getGeminiKey, withTimeout, CORE_NOTE_FIELDS, parseExtraSectionsField, serializeExtraSections, serializeLetterData, parseLetterData, buildLetterText, parseHospitalFormData } from '@/lib/utils'
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
import CustomLetterBuilderModal from '@/components/modals/CustomLetterBuilderModal'
import type { Note, NoteInput, AnyTemplate, Workplace, LetterType, CustomTemplateField, CustomTemplate, ExtraSection, CustomLetterTemplate, LetterData, ReferralFields, RecordsFields, FreetextFields } from '@/types'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

// Canonical LetterData for a letter of the given type, keeping only the fields
// that type uses. Shared by the letter autosave and the load path so both
// serialize identically — that's what lets the load path prime the
// "already saved" guard and avoid a redundant write (and updatedAt bump) on open.
function buildLetterPayload(parts: {
  letterType: LetterType
  common: LetterData['common']
  referral: ReferralFields
  records: RecordsFields
  freetext: FreetextFields
  customTemplate: CustomLetterTemplate | null
  customSections: { key: string; heading: string; content: string }[]
}): LetterData {
  const { letterType, common, referral, records, freetext, customTemplate, customSections } = parts
  return {
    common,
    ...(letterType === 'referral' ? { referral } : {}),
    ...(letterType === 'records' ? { records } : {}),
    ...(letterType === 'freetext' ? { freetext } : {}),
    ...(letterType === 'custom'
      ? {
          customTemplate: customTemplate ?? undefined,
          customSections: customSections.map(x => ({ key: x.key, heading: x.heading, content: x.content })),
        }
      : {}),
  }
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

const CORE_FIELD_SET = new Set<string>(CORE_NOTE_FIELDS as string[])

// Note fields are plain text, so a markdown table the model echoed from a
// template renders as walls of dashes. Drop the |---| separator rows and turn
// each data row into labelled lines using the table's header cells as labels.
function sanitizeTables(text: string): string {
  if (!text.includes('|')) return text
  const out: string[] = []
  let header: string[] | null = null
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    const isRow = t.startsWith('|') && t.endsWith('|') && t.length > 2
    if (isRow) {
      const cells = t.slice(1, -1).split('|').map(c => c.trim())
      const isSeparator = cells.every(c => /^:?-{1,}:?$/.test(c) || c === '')
      if (isSeparator) continue
      if (!header && cells.some(c => c) && cells.every(c => c.length <= 40)) { header = cells; continue }
      let wrote = false
      cells.forEach((c, i) => {
        if (!c) return
        const lbl = header && header[i] ? `${header[i]}: ` : ''
        out.push(`${lbl}${c}`); wrote = true
      })
      if (wrote) out.push('')
      continue
    }
    header = null
    out.push(raw)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normSectionLabel(s: string): string {
  return s
    .replace(/<\/?u>/gi, '')
    .replace(/[*_#]+/g, '')
    .replace(/[:.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Generic core-field synonyms for the heading fallback (when the model ignores
// the [key] markers). The template's own section labels are matched first.
const CORE_LABEL_MAP: Record<string, keyof Note> = {
  'presentation': 'presentation', 'current presentation': 'presentation',
  'presenting problem': 'presentation', 'presenting problems': 'presentation',
  'presenting problem(s)': 'presentation', 'presenting concerns': 'presentation',
  'history': 'history', 'background': 'history',
  'medications': 'medications', 'current medications': 'medications',
  'mental status': 'mse', 'mse': 'mse', 'mental status examination': 'mse',
  'mental status exam': 'mse', 'mental state exam': 'mse',
  'mental status examination (mse)': 'mse', 'mental state examination': 'mse',
  'session content': 'content', 'content': 'content',
  'scales': 'scales', 'rating scales': 'scales', 'measures': 'scales',
  'risk': 'risk', 'risk assessment': 'risk',
  'referrals': 'referrals', 'referral reason': 'referrals',
  'summary': 'summary', 'session summary': 'summary',
  'next steps': 'nextsteps', 'nextsteps': 'nextsteps', 'plan': 'nextsteps',
  'diagnosis': 'diagnosis', 'diagnoses': 'diagnosis',
}

interface ParsedNote { fields: Partial<Note>; extras: ExtraSection[] }

// Split AI output into the 11 core note fields plus any template-specific extra
// sections. Given the template, [key] markers map to core fields or the
// template's extra section keys; without markers, a heading fallback matches
// section labels; failing all that, the whole response becomes Session Content.
function parseGeneratedContent(content: string, template?: AnyTemplate | null): ParsedNote {
  const fields: Partial<Note> = {}
  const extraContent: Record<string, string> = {}

  const sections = (template && 'sections' in template && template.sections) ? template.sections : []
  const extraDefs = sections.filter(s => !s.core)
  const extraKeySet = new Set(extraDefs.map(s => s.key))
  const extraLabel = new Map(extraDefs.map(s => [s.key, s.label]))
  // Heading fallback lookup: every template section's normalized label -> key.
  const labelToKey = new Map<string, string>()
  for (const s of sections) labelToKey.set(normSectionLabel(s.label), s.key)

  const assign = (key: string, body: string) => {
    if (!body) return false
    if (CORE_FIELD_SET.has(key)) { (fields as Record<string, string>)[key] = body; return true }
    if (extraKeySet.has(key)) { extraContent[key] = body; return true }
    return false
  }

  // 1. [key] bracket markers. Keys are slug-shaped (a-z, digits, underscore).
  const bracketRx = /(?:^|\n)\*{0,2}\[([a-z][a-z0-9_]{1,40})\][^\n]*\n([\s\S]*?)(?=(?:^|\n)\*{0,2}\[[a-z][a-z0-9_]{1,40}\]|$)/g
  let m: RegExpExecArray | null
  let any = false
  while ((m = bracketRx.exec(content)) !== null) {
    if (assign(m[1], m[2].trim())) any = true
  }

  // 2. Heading fallback (### / #### / whole-line **bold**) when no markers hit.
  if (!any) {
    const lines = content.split('\n')
    let curKey: string | null = null
    let buf: string[] = []
    const flush = () => { if (curKey) { if (assign(curKey, buf.join('\n').trim())) any = true } buf = [] }
    for (const line of lines) {
      const md = line.match(/^\s*#{1,4}\s+(.+?)\s*$/)
      const bold = !md && line.match(/^\s*\*\*([^*\n]{2,80})\*\*:?\s*$/)
      const label = md ? md[1] : bold ? bold[1] : null
      if (label !== null) {
        const norm = normSectionLabel(label)
        const nextKey = labelToKey.get(norm) ?? CORE_LABEL_MAP[norm] ?? null
        if (nextKey) {
          flush()
          curKey = nextKey
        } else if (curKey) {
          // Unknown heading inside a known section (e.g. a **Behaviour:**
          // sub-heading within MSE) — keep it as body, don't drop what follows.
          buf.push(line)
        }
      } else if (curKey) {
        buf.push(line)
      }
    }
    flush()
  }

  // 3. Last resort: whole response → Session Content.
  if (!any) fields.content = content.trim()

  // Finalize: strip echoed titles, renumber bullets, sanitize tables.
  for (const key of Object.keys(fields) as (keyof Note)[]) {
    const v = (fields as Record<string, string>)[key]
    if (typeof v === 'string') {
      (fields as Record<string, string>)[key] = sanitizeTables(bulletsToNumbered(stripRedundantSectionLabel(key, v)))
    }
  }
  const extras: ExtraSection[] = extraDefs.map(s => ({
    key: s.key,
    label: extraLabel.get(s.key) ?? s.label,
    content: extraContent[s.key] ? sanitizeTables(bulletsToNumbered(extraContent[s.key])) : '',
  }))
  return { fields, extras }
}

// The full section render order (core + extra keys) a template declares, or []
// for content-only templates / no template (=> canonical field order).
function templateSectionKeys(t?: AnyTemplate | null): string[] {
  const s = t && 'sections' in t ? t.sections : undefined
  if (!s || (s.length === 1 && s[0].key === 'content')) return []
  return s.map(x => x.key)
}

// The 11 core note fields in canonical order, with their default labels and
// which are list fields (Enter auto-numbers). Used to render fields data-driven.
const CORE_FIELD_DEFS: { key: keyof Note; label: string; list: boolean }[] = [
  { key: 'diagnosis',    label: 'Diagnosis',                  list: false },
  { key: 'presentation', label: 'Presentation',               list: false },
  { key: 'history',      label: 'History',                    list: false },
  { key: 'medications',  label: 'Medications',                list: false },
  { key: 'mse',          label: 'Mental Status Examination',  list: false },
  { key: 'content',      label: 'Session Content',            list: true  },
  { key: 'scales',       label: 'Scales',                     list: true  },
  { key: 'risk',         label: 'Risk',                       list: true  },
  { key: 'referrals',    label: 'Referrals',                  list: true  },
  { key: 'summary',      label: 'Summary',                    list: false },
  { key: 'nextsteps',    label: 'Next Steps',                 list: true  },
]
const CORE_DEF_BY_KEY = new Map(CORE_FIELD_DEFS.map(d => [d.key as string, d]))


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
  const latestFieldsRef = useRef<Partial<Note>>(store.currentNote)
  // Template-specific extra sections + the full section render order (core+extra
  // keys). Empty order => canonical field order (today's behaviour). latest*Ref
  // mirror the state for the ref-based autosave path.
  const [extras, setExtrasState] = useState<ExtraSection[]>(() => parseExtraSectionsField(store.currentNote.extraSections).extras)
  const [sectionOrder, setSectionOrderState] = useState<string[]>(() => parseExtraSectionsField(store.currentNote.extraSections).order)
  const latestExtrasRef = useRef<ExtraSection[]>(extras)
  const latestOrderRef = useRef<string[]>(sectionOrder)
  // Empty fields (core or extra) collapse to a "label +" row; tapping + adds the
  // key here to reveal a compact textarea.
  const [expandedEmpty, setExpandedEmpty] = useState<Set<string>>(new Set())
  // Keep latestFieldsRef.current.extraSections in sync whenever extras/order
  // change, synchronously — the store is synced right after generation (before
  // any effect could run), and the Export tab reads extras from store.currentNote.
  const syncExtraSectionsIntoFields = () => {
    latestFieldsRef.current = {
      ...latestFieldsRef.current,
      extraSections: serializeExtraSections(latestOrderRef.current, latestExtrasRef.current),
    }
  }
  const setExtras = (next: ExtraSection[]) => { latestExtrasRef.current = next; setExtrasState(next); syncExtraSectionsIntoFields() }
  const setSectionOrder = (next: string[]) => { latestOrderRef.current = next; setSectionOrderState(next); syncExtraSectionsIntoFields() }
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)
  // Letter autosave: a saved letter lives in progress_notes as a docType 'letter'.
  // lastSavedLetterDataRef holds the last-persisted serialized payload so an
  // unchanged letter (e.g. one just re-opened) doesn't trigger a redundant write.
  const letterSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedLetterDataRef = useRef<string | null>(null)
  // Whether store.currentNoteId currently points at a saved LETTER doc (vs a note).
  // Letter autosave only ever updates a doc it knows is a letter — otherwise it
  // creates a fresh one — so a letter can never overwrite a clinical note.
  const currentDocIsLetterRef = useRef(false)
  // Always-latest doAutoSaveLetter so the debounce and unmount flush use current
  // user/profile/store, not a stale first-render closure.
  const doAutoSaveLetterRef = useRef<() => void>(() => {})
  const [letterSaveState, setLetterSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const [fieldFocused, setFieldFocused] = useState(false)
  const [letterBarExpanded, setLetterBarExpanded] = useState(false)
  const [noteBarExpanded, setNoteBarExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [changeTemplateOpen, setChangeTemplateOpen] = useState(false)
  const [letterBuilderOpen, setLetterBuilderOpen] = useState(false)
  const [letterBuilderInitial, setLetterBuilderInitial] = useState<CustomLetterTemplate | null>(null)
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
      if (noteIdParam !== s.currentNoteId) {
        // Loading a different doc: exit any in-memory letter first. loadNote
        // re-enters letter mode itself if the target doc is a saved letter.
        if (s.letterType !== null) s.resetLetterMode()
        loadNote(noteIdParam)
      } else if (s.letterType === null) {
        // Same doc, note mode — keep the fields already in the store.
        latestFieldsRef.current = s.currentNote
        setFields(s.currentNote)
      } else {
        // Same letter doc carried over in the store on a fresh mount: reload so the
        // edit-page save guards (currentDocIsLetterRef / lastSavedLetterDataRef) get
        // primed. Without this, the first autosave would create a duplicate.
        loadNote(noteIdParam)
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
    // A saved hospital form re-opens in the form editor (rendered by the early
    // return above). Resolve its config; if either the payload or config is gone,
    // fall through and show it as a plain note (body lives in `content`).
    if (note.docType === 'hospital-form') {
      const data = parseHospitalFormData(note.formData)
      const cfg = data ? await getHospitalForm(data.formKey) : null
      if (data && cfg && mountedRef.current) {
        store.resetLetterMode()
        store.setHospitalForm(cfg)
        store.setHospitalFormData(data)
        store.setHospitalFormNoteId(noteId)
        store.setPendingHospitalFormGeneration(false)
        store.setLastTranscript(note.transcript ?? null)
        return
      }
      // fall through to note rendering
    }
    // Not a hospital form → make sure form mode is cleared before showing note/letter.
    store.resetHospitalForm()
    // A saved letter re-opens in letter mode instead of the note editor. If its
    // payload is somehow unreadable, fall through and show it as a note (its body
    // still lives in `content`) rather than a blank screen.
    if (note.docType === 'letter' && note.letterType) {
      const parsed = parseLetterData(note.letterData)
      store.resetLetterMode()
      if (parsed && hydrateLetterFromNote(store, note)) {
        currentDocIsLetterRef.current = true
        // Prime the "already saved" guard with the same serialization the
        // autosave will compute, so merely opening the letter doesn't re-write it.
        lastSavedLetterDataRef.current = serializeLetterData(buildLetterPayload({
          letterType: note.letterType,
          common: parsed.common,
          referral: parsed.referral ?? ({} as ReferralFields),
          records: parsed.records ?? ({} as RecordsFields),
          freetext: parsed.freetext ?? ({} as FreetextFields),
          customTemplate: parsed.customTemplate ?? null,
          customSections: parsed.customSections ?? [],
        })) ?? ''
        const cn: Partial<Note> = { patient: note.patient, date: note.date }
        latestFieldsRef.current = cn
        setFields(cn)
        store.setCurrentNote(cn)
        return
      }
    }
    currentDocIsLetterRef.current = false
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
      extraSections:  note.extraSections,
    }
    latestFieldsRef.current = noteFields
    setFields(noteFields)
    const parsedExtra = parseExtraSectionsField(note.extraSections)
    setExtras(parsedExtra.extras)
    setSectionOrder(parsedExtra.order)
    setExpandedEmpty(new Set())
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

  // Autosave the letter (debounced) whenever its fields change — including right
  // after generation fills them. Skipped while a generation is in flight so a
  // half-populated letter isn't persisted. doAutoSaveLetter itself no-ops when
  // the letter has no patient yet or nothing changed since the last save.
  useEffect(() => {
    if (!isLetterMode || !user || isGeneratingLetter) return
    if (letterSaveTimerRef.current) clearTimeout(letterSaveTimerRef.current)
    letterSaveTimerRef.current = setTimeout(() => { doAutoSaveLetterRef.current() }, 800)
    return () => { if (letterSaveTimerRef.current) clearTimeout(letterSaveTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLetterMode, user, isGeneratingLetter, store.letterType, store.letterCommonFields,
      store.referralFields, store.recordsFields, store.freetextFields, store.customLetterSections])

  // Flush a pending letter save on unmount so navigating away right after an edit
  // (or generation) never loses it. Fire-and-forget; the mounted guards inside
  // doAutoSaveLetter keep it from touching unmounted state.
  useEffect(() => () => {
    if (storeRef.current.letterType !== null) doAutoSaveLetterRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Tell pull-to-refresh that reloading the edit screen right now would lose
  // in-progress work: an in-memory letter (autosaves only once it names a patient)
  // or a save in flight. The gesture confirms with the doctor before reloading.
  useEffect(() => {
    registerReloadGuard(() => storeRef.current.letterType !== null || isSavingRef.current)
    return () => registerReloadGuard(null)
  }, [])

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
        // '' (not undefined) so regenerating with a template that has no extras
        // clears any previously-stored sections — undefined would be dropped by
        // ignoreUndefinedProperties, leaving the old extras stale. Requires the
        // extraSections Firestore rule to be published (deploy is gated on it).
        extraSections:  serializeExtraSections(latestOrderRef.current, latestExtrasRef.current) ?? '',
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

  // Persist the current letter to progress_notes (as a docType 'letter' doc) so it
  // shows up under its patient in Patients/History and is searchable by the AI
  // assistant, exactly like a clinical note. Builds the structured payload
  // (letterData) plus a plain-text body (content) for the list/preview/search
  // surfaces. No-ops until the letter names a patient, and skips a write when
  // nothing has changed since the last save.
  async function doAutoSaveLetter() {
    const s = storeRef.current
    const lt = s.letterType
    if (lt === null || !user) return
    if (isSavingRef.current) return
    const common = s.letterCommonFields
    const patientName = (common.patientName || '').trim()
    if (!patientName) return

    const data = buildLetterPayload({
      letterType: lt,
      common,
      referral: s.referralFields,
      records: s.recordsFields,
      freetext: s.freetextFields,
      customTemplate: s.customLetterTemplate,
      customSections: s.customLetterSections,
    })
    const serialized = serializeLetterData(data) ?? ''
    if (serialized === lastSavedLetterDataRef.current) return

    const body = buildLetterText({
      letterType: lt,
      common,
      referral: s.referralFields,
      records: s.recordsFields,
      freetext: s.freetextFields,
      customSections: s.customLetterSections,
    })
    const now = new Date()
    const dateStr = common.letterDate
      || `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`

    const noteData: NoteInput = {
      userId: user.uid,
      patient: patientName,
      reg_number: '',
      date: dateStr,
      time: '',
      clinician: profile?.displayName ?? '',
      session_number: '', attendance: '', diagnosis: '', presentation: '', history: '',
      medications: '', mse: '', content: body.slice(0, 15000), scales: '', risk: '',
      referrals: '', summary: '', nextsteps: '',
      docType: 'letter',
      letterType: lt,
      letterData: serialized,
      transcript: s.lastTranscript ? s.lastTranscript.slice(0, 50000) : undefined,
      transcriptMode: s.lastTranscriptMode,
    }

    // Only update in place when we know the current doc is THIS letter; otherwise
    // create a new doc so we never clobber a clinical note that happens to be the
    // current note id.
    const targetId = s.currentNoteId && currentDocIsLetterRef.current ? s.currentNoteId : null
    isSavingRef.current = true
    setLetterSaveState('saving')
    try {
      if (targetId) {
        await updateNote(targetId, noteData)
      } else {
        const id = await saveNote(noteData)
        s.setCurrentNoteId(id)
        currentDocIsLetterRef.current = true
      }
      lastSavedLetterDataRef.current = serialized
      if (s.lastTranscript && s.lastTranscript.trim() && !draftClearedRef.current) {
        draftClearedRef.current = true
        deleteTranscriptDraft(user.uid).catch(() => {})
      }
      if (mountedRef.current) {
        setLetterSaveState('saved')
        setTimeout(() => { if (mountedRef.current) setLetterSaveState('idle') }, 1500)
      }
    } catch {
      if (mountedRef.current) setLetterSaveState('idle')
    } finally {
      isSavingRef.current = false
    }
  }
  doAutoSaveLetterRef.current = doAutoSaveLetter

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

  function animateFields(parsed: { fields: Partial<Note>; extras: ExtraSection[] }, order: string[] = []) {
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

    const next = { ...latestFieldsRef.current, ...parsed.fields }
    latestFieldsRef.current = next
    setFields(next)
    setExtras(parsed.extras)
    setSectionOrder(order)
    setExpandedEmpty(new Set())

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

  // Leaving a letter to (re)generate a note: the letter has its own saved doc, so
  // detach from it and start the note as a fresh doc — the letter is never
  // overwritten and stays available under the patient.
  function leaveLetterForNewNote() {
    store.resetLetterMode()
    store.setCurrentNoteId(null)
    currentDocIsLetterRef.current = false
    lastSavedLetterDataRef.current = null
  }

  // Entering a brand-new letter (e.g. from a note via the Change Template letters
  // tab). Detach from any current-note id so the letter's first autosave creates
  // its own doc rather than updating the note we came from.
  function enterFreshLetter() {
    currentDocIsLetterRef.current = false
    lastSavedLetterDataRef.current = null
  }

  function handleTemplateChange(newTemplate: AnyTemplate, noteLength?: string) {
    setChangeTemplateOpen(false)
    const wasLetter = store.letterType !== null
    if (store.lastTranscript) {
      // Only warn before overwriting a note that already has generated content.
      // An empty note (interrupted / never generated) has nothing to lose, so go
      // straight to generation.
      if (noteHasContent && !window.confirm(`Regenerate note with "${newTemplate.title}"?`)) return
      if (wasLetter) leaveLetterForNewNote()
      if (noteLength) store.setOverrideNoteLength(noteLength as 'brief' | 'balanced' | 'detailed')
      runGeneration(store.lastTranscript, newTemplate)
    } else {
      // No transcript to regenerate from — just leave letter mode (if any) and keep
      // the existing note fields. Used when switching a letter back to its note.
      if (wasLetter) leaveLetterForNewNote()
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
      // Coming from a note: this letter is a NEW doc (the note keeps its own).
      enterFreshLetter()
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

  // Switch the current patient into a custom letter (from the Change Template
  // letters tab), carrying the patient name over and seeding the topic fields.
  function handleSelectCustomLetter(t: CustomLetterTemplate) {
    setChangeTemplateOpen(false)
    const alreadyLetter = store.letterType !== null
    store.setLetterType('custom')
    store.setCustomLetterTemplate(t)
    store.setCustomLetterSections(t.sections.map(s => ({ key: s.key, heading: s.heading, content: '' })))
    if (!alreadyLetter) {
      enterFreshLetter()
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
    }
    if (formScrollRef.current) formScrollRef.current.scrollTop = 0
  }

  async function handleSaveLetterTemplate(t: CustomLetterTemplate) {
    setLetterBuilderOpen(false)
    setLetterBuilderInitial(null)
    if (!user) return
    const current = profile?.customLetterTemplates ?? []
    const next = current.some(x => x.id === t.id) ? current.map(x => x.id === t.id ? t : x) : [...current, t]
    await updateProfile(user.uid, { customLetterTemplates: next }).catch(() => {})
    await refreshProfile()
    // If we're editing the letter currently open, refresh its sections to match.
    if (store.letterType === 'custom' && store.customLetterTemplate?.id === t.id) {
      store.setCustomLetterTemplate(t)
      const byKey = new Map(store.customLetterSections.map(s => [s.key, s.content]))
      store.setCustomLetterSections(t.sections.map(s => ({ key: s.key, heading: s.heading, content: byKey.get(s.key) ?? '' })))
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

      const parsed = parseGeneratedContent(data.content, template)
      animateFields(parsed, templateSectionKeys(template))

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
      const parsed = parseGeneratedContent(data.content, template)
      animateFields(parsed, templateSectionKeys(template))
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


  async function handleGenerateFromTranscript() {
    if (!store.lastTranscript || !letterType) return
    setIsGeneratingLetter(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const geminiKey = getGeminiKey()
      if (geminiKey) headers['x-gemini-key'] = geminiKey
      const customLetter = letterType === 'custom' && store.customLetterTemplate
        ? {
            title: store.customLetterTemplate.title,
            prompt: store.customLetterTemplate.prompt,
            sections: store.customLetterTemplate.sections,
          }
        : undefined
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: 'letter', letterType, transcript: store.lastTranscript, customLetter }),
      })
      const data = await res.json() as { letterFields?: Record<string, unknown>; error?: string }
      if (data.letterFields) {
        const { recipientName, recipientAddress, patientName, dob, sections, ...typeFields } = data.letterFields
        store.setLetterCommonFields({
          ...(recipientName !== undefined && { recipientName: String(recipientName) }),
          ...(recipientAddress !== undefined && { recipientAddress: String(recipientAddress) }),
          ...(patientName !== undefined && { patientName: String(patientName) }),
          ...(dob !== undefined && { dob: String(dob) }),
        })
        if (letterType === 'referral') store.setReferralFields(typeFields as Parameters<typeof store.setReferralFields>[0])
        else if (letterType === 'records') store.setRecordsFields(typeFields as Parameters<typeof store.setRecordsFields>[0])
        else if (letterType === 'freetext') store.setFreetextFields(typeFields as Parameters<typeof store.setFreetextFields>[0])
        else if (letterType === 'custom' && sections && typeof sections === 'object') {
          const secMap = sections as Record<string, unknown>
          store.setCustomLetterSections(
            store.customLetterSections.map(s => ({ ...s, content: secMap[s.key] !== undefined ? String(secMap[s.key]) : s.content }))
          )
        }
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
    const template = store.lastChosenTemplate
    const parsed = parseGeneratedContent(pasted, template)
    const hasClinical =
      Object.keys(parsed.fields).some(k => k !== 'patient' && k !== 'date' && (parsed.fields as Record<string, string>)[k]?.trim()) ||
      parsed.extras.some(e => e.content.trim())
    if (!hasClinical) return false
    animateFields(parsed, templateSectionKeys(template))
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

  // Edit one extra section's content (mirrors setField for core fields).
  function setExtraContent(key: string, value: string) {
    setExtras(latestExtrasRef.current.map(e => e.key === key ? { ...e, content: value } : e))
  }

  // Reveal a collapsed empty field's textarea and focus it.
  function expandField(key: string) {
    setExpandedEmpty(prev => new Set(prev).add(key))
    setTimeout(() => {
      const el = formScrollRef.current?.querySelector(`[data-field="${key}"] textarea`) as HTMLTextAreaElement | null
      el?.focus()
    }, 50)
  }

  // A collapsed empty section: just its title + a "＋" to reveal the textarea.
  function renderCollapsedField(key: string, label: string) {
    return (
      <button
        type="button"
        onClick={() => expandField(key)}
        className="flex items-center justify-between w-full text-left px-3 py-2 rounded-[var(--r)]
                   border border-dashed border-[var(--border)] text-[var(--text3)]
                   hover:border-[var(--blue)] hover:text-[var(--text2)] motion-safe:transition-colors"
      >
        <span className="text-sm font-medium">{label}</span>
        <span className="text-lg leading-none" aria-hidden>+</span>
      </button>
    )
  }

  function renderCoreField(def: { key: keyof Note; label: string; list: boolean }) {
    const value = (fields[def.key] as string | undefined) ?? ''
    const expanded = value.trim().length > 0 || expandedEmpty.has(def.key)
    return (
      <div key={def.key}>
        <div data-field={def.key}>
          {expanded ? (
            <Textarea
              label={def.label}
              rows={2}
              autoResize
              value={value}
              onChange={e => setField(def.key, e.target.value)}
              onBlur={() => handleFieldBlur(def.key)}
              onKeyDown={def.list ? (e => handleListKeyDown(e, def.key)) : undefined}
              className={saveFlashFields.has(def.key) ? 'save-flash' : ''}
            />
          ) : renderCollapsedField(def.key, def.label)}
        </div>
        {renderDivider('after-' + def.key)}
      </div>
    )
  }

  function renderExtraField(extra: ExtraSection) {
    const value = extra.content ?? ''
    const expanded = value.trim().length > 0 || expandedEmpty.has(extra.key)
    return (
      <div key={extra.key}>
        <div data-field={extra.key}>
          {expanded ? (
            <Textarea
              label={extra.label}
              rows={2}
              autoResize
              value={value}
              onChange={e => setExtraContent(extra.key, e.target.value)}
              onBlur={() => handleFieldBlur(extra.key)}
              className={saveFlashFields.has(extra.key) ? 'save-flash' : ''}
            />
          ) : renderCollapsedField(extra.key, extra.label)}
        </div>
        {renderDivider('after-' + extra.key)}
      </div>
    )
  }

  // Ordered field render plan: template section order first (core fields render
  // their core textarea, extra keys render an extra textarea), then any core
  // fields not in that order in canonical order. No order => canonical order.
  function renderNoteSections() {
    const extraByKey = new Map(extras.map(e => [e.key, e]))
    const order = sectionOrder.length ? sectionOrder : (CORE_NOTE_FIELDS as string[])
    const seen = new Set<string>()
    const out: React.ReactNode[] = []
    for (const key of order) {
      if (seen.has(key)) continue
      seen.add(key)
      const core = CORE_DEF_BY_KEY.get(key)
      if (core) out.push(renderCoreField(core))
      else if (extraByKey.has(key)) out.push(renderExtraField(extraByKey.get(key)!))
    }
    for (const e of extras) {
      if (!seen.has(e.key)) { seen.add(e.key); out.push(renderExtraField(e)) }
    }
    for (const def of CORE_FIELD_DEFS) {
      if (!seen.has(def.key as string)) { seen.add(def.key as string); out.push(renderCoreField(def)) }
    }
    return out
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
  const noteHasContent =
    CORE_NOTE_FIELDS.some(k => String(fields[k] ?? '').trim()) ||
    extras.some(e => e.content.trim())
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

  // A hospital form takes over the Edit tab entirely (its own editor). All the
  // note/letter hooks above still ran; they no-op without a note/letter loaded.
  if (store.hospitalForm) {
    return <HospitalFormView />
  }

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
                : letterType === 'custom' ? (store.customLetterTemplate?.title ?? 'Letter')
                : 'Free Text Letter'}
            </span>
            {letterSaveState !== 'idle' && (
              <span className="text-[11px] text-white/80 shrink-0" aria-live="polite">
                {letterSaveState === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
            <button
              onClick={() => setLetterBarExpanded(v => !v)}
              aria-label={letterBarExpanded ? 'Collapse layout controls' : 'Expand layout controls'}
              aria-pressed={letterBarExpanded}
              className={`w-6 h-6 flex items-center justify-center rounded-full border motion-safe:transition-all shrink-0 ml-auto ${
                letterBarExpanded ? 'bg-white text-[var(--blue)] border-white' : 'bg-white/15 border-white/40 text-white'
              }`}
              style={{ transform: letterBarExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transitionDuration: '200ms' }}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
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

                {/* Custom letter — one field per template topic; empty ones collapse. */}
                {letterType === 'custom' && (
                  <div className="space-y-3">
                    {store.customLetterSections.map(s => {
                      const expanded = s.content.trim().length > 0 || expandedEmpty.has(s.key)
                      return (
                        <div key={s.key} data-field={s.key}>
                          {expanded ? (
                            <Textarea
                              label={s.heading}
                              rows={3}
                              autoResize
                              value={s.content}
                              onChange={e => store.updateCustomLetterSection(s.key, e.target.value)}
                            />
                          ) : renderCollapsedField(s.key, s.heading)}
                        </div>
                      )
                    })}
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
            {renderNoteSections()}

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
        customLetterTemplates={profile?.customLetterTemplates ?? []}
        onSelectCustomLetter={handleSelectCustomLetter}
        onEditCustomLetter={(t) => { setChangeTemplateOpen(false); setLetterBuilderInitial(t); setLetterBuilderOpen(true) }}
        onCreateLetterTemplate={() => { setChangeTemplateOpen(false); setLetterBuilderInitial(null); setLetterBuilderOpen(true) }}
      />
      <CustomLetterBuilderModal
        open={letterBuilderOpen}
        initial={letterBuilderInitial}
        onSave={handleSaveLetterTemplate}
        onClose={() => { setLetterBuilderOpen(false); setLetterBuilderInitial(null) }}
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
