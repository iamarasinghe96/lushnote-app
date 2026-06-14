'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { saveNote, updateNote, listNotes } from '@/lib/firestore/notes'
import { buildPreviewHTML, buildLetterPreviewHTML, formatDateForLetter, calculateAgeFromDOB } from '@/lib/utils'
import { getPersonalisationPrefix } from '@/lib/personalisation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import TimePicker from '@/components/ui/TimePicker'
import TemplatePicker from '@/components/modals/TemplatePicker'
import ReassignModal from '@/components/modals/ReassignModal'
import type { Note, NoteInput, AnyTemplate, Workplace, LetterType } from '@/types'

const FIELD_ORDER = [
  'patient', 'date', 'diagnosis', 'presentation', 'history', 'medications', 'mse',
  'content', 'scales', 'risk', 'referrals', 'summary', 'nextsteps',
] as const

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

function parseGeneratedContent(content: string): Partial<Note> {
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
  const out: Partial<Note> = {}
  const rx = /#{1,3}\s+([^\n]+)\n([\s\S]*?)(?=#{1,3}\s+|$)/g
  let m = rx.exec(content)
  let parsed = false
  while (m !== null) {
    const key = sectionMap[m[1].trim().toLowerCase()]
    if (key) { (out as Record<string, string>)[key] = m[2].trim(); parsed = true }
    m = rx.exec(content)
  }
  if (!parsed) out.content = content.trim()
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

export default function EditPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const store = useNoteStore()

  const [fields, setFields] = useState<Partial<Note>>(() => {
    if (store.pendingAnimation) {
      const base = { ...store.currentNote }
      for (const key of FIELD_ORDER) delete (base as Record<string, unknown>)[key]
      return base
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
  const [changeTemplateOpen, setChangeTemplateOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false)
  const [visitCount, setVisitCount] = useState<number | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const autoSaveEnabledRef = useRef(true)
  const latestFieldsRef = useRef<Partial<Note>>(store.currentNote)

  // Letter mode state — declared before effects that reference these
  const letterType = store.letterType as LetterType | null
  const isLetterMode = letterType !== null
  const letterCommonFields = store.letterCommonFields
  const referralFields = store.referralFields
  const recordsFields = store.recordsFields
  const freetextFields = store.freetextFields
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false)
  const [letterToast, setLetterToast] = useState<string | null>(null)

  useEffect(() => { return () => { mountedRef.current = false } }, [])

  useEffect(() => {
    if (store.pendingAnimation) {
      store.setPendingAnimation(false)
      const toAnimate: Partial<Note> = {}
      for (const key of FIELD_ORDER) {
        const v = (store.currentNote as Record<string, string>)[key]
        if (v) (toAnimate as Record<string, string>)[key] = v
      }
      animateFields(toAnimate)
    } else {
      latestFieldsRef.current = store.currentNote
      setFields(store.currentNote)
      setPreviewHtml(buildPreviewHTML(store.currentNote))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const next = { ...fields, [key]: value }
    latestFieldsRef.current = next
    setFields(next)
    store.setCurrentNote(next)
  }

  // Patient autocomplete index — preserves original name casing
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
      // silent fail — auto-save errors are non-blocking
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
    setIsAnimating(true)

    if (reduced) {
      setFields(prev => {
        const next = { ...prev, ...noteFields }
        latestFieldsRef.current = next
        return next
      })
      setIsAnimating(false)
      autoSaveEnabledRef.current = true
      triggerAutoSave()
      return
    }

    for (const key of FIELD_ORDER) {
      if (!mountedRef.current) break
      const value = (noteFields as Record<string, string>)[key]
      if (!value || typeof value !== 'string') continue
      await typewriterField(key, value)
    }

    if (mountedRef.current) {
      setIsAnimating(false)
      autoSaveEnabledRef.current = true
      triggerAutoSave()
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

  function handleTemplateChange(newTemplate: AnyTemplate) {
    setChangeTemplateOpen(false)
    if (!window.confirm(`Regenerate note with "${newTemplate.title}"?`)) return
    runGeneration(store.lastTranscript ?? '', newTemplate)
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
      const noteLength = profile?.personalisation?.noteLength ?? 'balanced'
      const systemPrompt = profile ? getPersonalisationPrefix(profile, noteLength) : ''
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = sessionStorage.getItem('groq_api_key')
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transcript, templatePrompt: template.prompt, systemPrompt, uid: user!.uid }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Generation failed')
      }
      const data = await res.json() as { content: string }
      clearInterval(statusTimer)
      setGenerationStatus(null)
      if (!mountedRef.current) return
      setIsGenerating(false)
      const noteFields = parseGeneratedContent(data.content)
      await animateFields(noteFields)
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
          className={`flex items-center justify-between px-4 py-2 text-white text-sm shrink-0
            bg-gradient-to-r from-[#0e9f6e] to-[#059669]
            ${isGenerating ? 'animate-pulse' : ''}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isAnimating ? (
              <div className="h-4 w-48 rounded bg-white/30 animate-[shimmer_1.5s_infinite]" />
            ) : isGenerating ? (
              <span className="font-medium truncate">{generationStatus ?? 'Generating…'}</span>
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

      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[55%_45%]">

        {/* LEFT: form */}
        <div className="overflow-y-auto p-4">
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

            {/* Clinical note fields — hidden in letter mode */}
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
            <div className="grid grid-cols-2 gap-3">
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
            <div className="grid grid-cols-2 gap-3">
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
            <Textarea
              label="Diagnosis"
              rows={3}
              value={fields.diagnosis ?? ''}
              onChange={e => setField('diagnosis', e.target.value)}
              onBlur={() => handleFieldBlur('diagnosis')}
              className={saveFlashFields.has('diagnosis') ? 'save-flash' : ''}
            />
            <Textarea
              label="Presentation"
              rows={5}
              value={fields.presentation ?? ''}
              onChange={e => setField('presentation', e.target.value)}
              onBlur={() => handleFieldBlur('presentation')}
              className={saveFlashFields.has('presentation') ? 'save-flash' : ''}
            />
            <Textarea
              label="History"
              rows={5}
              value={fields.history ?? ''}
              onChange={e => setField('history', e.target.value)}
              onBlur={() => handleFieldBlur('history')}
              className={saveFlashFields.has('history') ? 'save-flash' : ''}
            />
            <Textarea
              label="Medications"
              rows={3}
              value={fields.medications ?? ''}
              onChange={e => setField('medications', e.target.value)}
              onBlur={() => handleFieldBlur('medications')}
              className={saveFlashFields.has('medications') ? 'save-flash' : ''}
            />
            <Textarea
              label="Mental Status Examination"
              rows={5}
              value={fields.mse ?? ''}
              onChange={e => setField('mse', e.target.value)}
              onBlur={() => handleFieldBlur('mse')}
              className={saveFlashFields.has('mse') ? 'save-flash' : ''}
            />
            <Textarea
              label="Session Content"
              rows={8}
              value={fields.content ?? ''}
              onChange={e => setField('content', e.target.value)}
              onBlur={() => handleFieldBlur('content')}
              onKeyDown={e => handleListKeyDown(e, 'content')}
              className={saveFlashFields.has('content') ? 'save-flash' : ''}
            />
            <Textarea
              label="Scales"
              rows={3}
              value={fields.scales ?? ''}
              onChange={e => setField('scales', e.target.value)}
              onBlur={() => handleFieldBlur('scales')}
              onKeyDown={e => handleListKeyDown(e, 'scales')}
              className={saveFlashFields.has('scales') ? 'save-flash' : ''}
            />
            <Textarea
              label="Risk"
              rows={4}
              value={fields.risk ?? ''}
              onChange={e => setField('risk', e.target.value)}
              onBlur={() => handleFieldBlur('risk')}
              onKeyDown={e => handleListKeyDown(e, 'risk')}
              className={saveFlashFields.has('risk') ? 'save-flash' : ''}
            />
            <Textarea
              label="Referrals"
              rows={3}
              value={fields.referrals ?? ''}
              onChange={e => setField('referrals', e.target.value)}
              onBlur={() => handleFieldBlur('referrals')}
              onKeyDown={e => handleListKeyDown(e, 'referrals')}
              className={saveFlashFields.has('referrals') ? 'save-flash' : ''}
            />
            <Textarea
              label="Summary"
              rows={5}
              value={fields.summary ?? ''}
              onChange={e => setField('summary', e.target.value)}
              onBlur={() => handleFieldBlur('summary')}
              className={saveFlashFields.has('summary') ? 'save-flash' : ''}
            />
            <Textarea
              label="Next Steps"
              rows={3}
              value={fields.nextsteps ?? ''}
              onChange={e => setField('nextsteps', e.target.value)}
              onBlur={() => handleFieldBlur('nextsteps')}
              onKeyDown={e => handleListKeyDown(e, 'nextsteps')}
              className={saveFlashFields.has('nextsteps') ? 'save-flash' : ''}
            />

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

        {/* RIGHT: live preview — hidden on mobile unless toggled */}
        <div
          className={`${showMobilePreview ? 'flex' : 'hidden'} md:flex flex-col border-l border-[var(--border)]`}
          style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)' }}
        >
          <div
            className="sticky top-0 border-b border-[var(--border)] px-4 py-2"
            style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(12px)' }}
          >
            <span className="text-xs font-semibold text-[var(--text3)] uppercase tracking-wide">Preview</span>
          </div>
          <div
            className="flex-1 overflow-y-auto p-4 preview-pane"
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
