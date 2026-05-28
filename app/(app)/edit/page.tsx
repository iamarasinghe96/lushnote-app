'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { saveNote, updateNote, listNotes } from '@/lib/firestore/notes'
import { buildPreviewHTML } from '@/lib/utils'
import { getPersonalisationPrefix } from '@/lib/personalisation'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import DatePicker from '@/components/ui/DatePicker'
import TimePicker from '@/components/ui/TimePicker'
import TemplatePicker from '@/components/modals/TemplatePicker'
import ReassignModal from '@/components/modals/ReassignModal'
import type { Note, NoteInput, AnyTemplate, Workplace } from '@/types'

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

  const [fields, setFields] = useState<Partial<Note>>(store.currentNote)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [previewHtml, setPreviewHtml] = useState(() => buildPreviewHTML(store.currentNote))
  const [showMobilePreview, setShowMobilePreview] = useState(false)
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [changeTemplateOpen, setChangeTemplateOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [allNotes, setAllNotes] = useState<Note[]>([])
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false)
  const [visitCount, setVisitCount] = useState<number | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => { return () => { mountedRef.current = false } }, [])

  useEffect(() => {
    setFields(store.currentNote)
    setPreviewHtml(buildPreviewHTML(store.currentNote))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setPreviewHtml(buildPreviewHTML(fields)), 200)
    return () => clearTimeout(timer)
  }, [fields])

  useEffect(() => {
    if (!user) return
    listNotes(user.uid).then(setAllNotes).catch(() => {})
  }, [user?.uid])

  const storeRef = useRef(store)
  storeRef.current = store

  const scheduleSave = useCallback((data: Partial<Note>) => {
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
    setFields(next)
    store.setCurrentNote(next)
    scheduleSave(next)
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
    setFields(next)
    store.setCurrentNote(next)
    scheduleSave(next)
    setPatientDropdownOpen(false)
  }

  // Reg number validation
  const activeWorkplace = profile?.workplaces?.find(w => w.id === profile.activeWorkplaceId)
  const regStatus = useMemo(
    () => checkRegStatus(fields.reg_number ?? '', activeWorkplace),
    [fields.reg_number, activeWorkplace]
  )

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
      const noteFields = parseGeneratedContent(data.content)
      const next = { ...fields, ...noteFields }
      setFields(next)
      store.setCurrentNote(next)
      scheduleSave(next)
    } catch {
      // silent — isGenerating clears in finally
    } finally {
      if (mountedRef.current) setIsGenerating(false)
    }
  }

  function handleReassign(patient: string, regNumber: string) {
    setReassignOpen(false)
    const next = { ...fields, patient, reg_number: regNumber }
    setFields(next)
    store.setCurrentNote(next)
    scheduleSave(next)
  }

  const sessionStats = store.lastTranscript && store.lastRecordingDuration > 0
    ? (() => {
        const wordCount = store.lastTranscript.trim().split(/\s+/).filter(Boolean).length
        const durationSeconds = store.lastRecordingDuration
        const wpm = durationSeconds > 0 ? Math.round(wordCount / (durationSeconds / 60)) : 0
        return { durationSeconds, wordCount, wpm }
      })()
    : null

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Current note bar */}
      {store.currentNoteId && (
        <div
          className={`flex items-center justify-between px-4 py-2 text-white text-sm shrink-0
            bg-gradient-to-r from-[#0e9f6e] to-[#059669]
            ${isGenerating ? 'animate-pulse' : ''}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isGenerating ? (
              <div className="h-4 w-32 bg-white/30 rounded animate-pulse" />
            ) : (
              <span className="font-medium truncate">
                {fields.patient || 'No patient'} · {fields.date || '—'}
              </span>
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
      {sessionStats && !isGenerating && (
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
                  onBlur={() => setTimeout(() => setPatientDropdownOpen(false), 200)}
                  autoComplete="off"
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
                className={
                  regStatus === 'valid' ? 'border-green-400' :
                  regStatus === 'invalid' ? 'border-red-400' : ''
                }
                hint={regStatus === 'invalid' ? `Expected format: ${activeWorkplace?.regTemplate ?? ''}` : undefined}
              />
            </div>

            {/* Date + Time */}
            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                label="Date"
                value={fields.date ?? ''}
                onChange={v => setField('date', v)}
              />
              <TimePicker
                label="Time"
                value={fields.time ?? ''}
                onChange={v => setField('time', v)}
              />
            </div>

            {/* Clinician + Session number */}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Clinician"
                value={fields.clinician ?? ''}
                onChange={e => setField('clinician', e.target.value)}
              />
              <Input
                label="Session number"
                value={fields.session_number ?? ''}
                onChange={e => setField('session_number', e.target.value)}
              />
            </div>

            <Input
              label="Attendance"
              value={fields.attendance ?? ''}
              onChange={e => setField('attendance', e.target.value)}
            />
            <Textarea
              label="Diagnosis"
              rows={3}
              value={fields.diagnosis ?? ''}
              onChange={e => setField('diagnosis', e.target.value)}
            />
            <Textarea
              label="Presentation"
              rows={5}
              value={fields.presentation ?? ''}
              onChange={e => setField('presentation', e.target.value)}
            />
            <Textarea
              label="History"
              rows={5}
              value={fields.history ?? ''}
              onChange={e => setField('history', e.target.value)}
            />
            <Textarea
              label="Medications"
              rows={3}
              value={fields.medications ?? ''}
              onChange={e => setField('medications', e.target.value)}
            />
            <Textarea
              label="Mental Status Examination"
              rows={5}
              value={fields.mse ?? ''}
              onChange={e => setField('mse', e.target.value)}
            />
            <Textarea
              label="Session Content"
              rows={8}
              value={fields.content ?? ''}
              onChange={e => setField('content', e.target.value)}
              onKeyDown={e => handleListKeyDown(e, 'content')}
            />
            <Textarea
              label="Scales"
              rows={3}
              value={fields.scales ?? ''}
              onChange={e => setField('scales', e.target.value)}
              onKeyDown={e => handleListKeyDown(e, 'scales')}
            />
            <Textarea
              label="Risk"
              rows={4}
              value={fields.risk ?? ''}
              onChange={e => setField('risk', e.target.value)}
              onKeyDown={e => handleListKeyDown(e, 'risk')}
            />
            <Textarea
              label="Referrals"
              rows={3}
              value={fields.referrals ?? ''}
              onChange={e => setField('referrals', e.target.value)}
              onKeyDown={e => handleListKeyDown(e, 'referrals')}
            />
            <Textarea
              label="Summary"
              rows={5}
              value={fields.summary ?? ''}
              onChange={e => setField('summary', e.target.value)}
            />
            <Textarea
              label="Next Steps"
              rows={3}
              value={fields.nextsteps ?? ''}
              onChange={e => setField('nextsteps', e.target.value)}
              onKeyDown={e => handleListKeyDown(e, 'nextsteps')}
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
