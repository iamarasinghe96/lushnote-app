'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useNoteStore } from '@/hooks/useNoteStore'
import { saveNote, updateNote } from '@/lib/firestore/notes'
import Input from '@/components/ui/Input'
import Textarea from '@/components/ui/Textarea'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import type { Note, NoteInput } from '@/types'

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

const MODE_LABEL: Record<string, string> = {
  paste:        'Pasted transcript',
  conversation: 'Session recording',
  dictation:    'Dictated note',
  document:     'Document',
  upload:       'Uploaded recording',
}

export default function EditPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const store = useNoteStore()

  const [fields, setFields] = useState<Partial<Note>>(store.currentNote)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [showTranscript, setShowTranscript] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  // Sync from store on first mount / after generation
  useEffect(() => {
    setFields(store.currentNote)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep a stable ref to the latest store so scheduleSave doesn't stale-close it
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

  function validateRegNumber() {
    const activeWp = profile?.workplaces?.find(w => w.id === profile.activeWorkplaceId)
    if (!activeWp?.regPattern || !fields.reg_number) {
      setRegError(null)
      return
    }
    const pattern = new RegExp(activeWp.regPattern)
    setRegError(pattern.test(fields.reg_number) ? null : 'Registration number format does not match')
  }

  function handleNewNote() {
    store.resetNote()
    router.push('/generate')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 pb-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-lg font-semibold text-[var(--text)]">Edit note</h1>
          <div className="flex items-center gap-3">
            {saveStatus === 'saving' && (
              <span className="text-xs text-[var(--text3)]">Saving…</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-[var(--green)]">Saved</span>
            )}
            <Button variant="ghost" size="sm" onClick={handleNewNote}>New note</Button>
          </div>
        </div>

        {/* Session stats */}
        {store.lastTranscript && store.lastRecordingDuration > 0 && (
          <div className="mb-5 rounded-[var(--r)] border border-[var(--border)] bg-white p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--text2)]">
                Recording: {formatDuration(store.lastRecordingDuration)}
              </span>
              <span className="text-xs text-[var(--text3)]">·</span>
              <span className="text-xs text-[var(--text2)]">
                {store.lastTranscript.split(/\s+/).filter(Boolean).length} words
              </span>
              <Badge variant="blue">
                {MODE_LABEL[store.lastTranscriptMode] ?? store.lastTranscriptMode}
              </Badge>
            </div>
          </div>
        )}

        {/* Fields */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Patient name"
              value={fields.patient ?? ''}
              onChange={e => setField('patient', e.target.value)}
            />
            <Input
              label="Registration number"
              value={fields.reg_number ?? ''}
              onChange={e => setField('reg_number', e.target.value)}
              onBlur={validateRegNumber}
              error={regError ?? undefined}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              value={fields.date ?? ''}
              onChange={e => setField('date', e.target.value)}
            />
            <Input
              label="Time"
              value={fields.time ?? ''}
              onChange={e => setField('time', e.target.value)}
            />
          </div>
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
          />
          <Textarea
            label="Scales"
            rows={3}
            value={fields.scales ?? ''}
            onChange={e => setField('scales', e.target.value)}
          />
          <Textarea
            label="Risk"
            rows={4}
            value={fields.risk ?? ''}
            onChange={e => setField('risk', e.target.value)}
          />
          <Textarea
            label="Referrals"
            rows={3}
            value={fields.referrals ?? ''}
            onChange={e => setField('referrals', e.target.value)}
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
          />
        </div>

        {/* Raw transcript */}
        {store.lastTranscript && (
          <div className="mt-6">
            <button
              onClick={() => setShowTranscript(v => !v)}
              className="text-sm text-[var(--blue)] hover:underline"
            >
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
            {showTranscript && (
              <pre className="mt-2 rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)]
                              p-3 text-xs text-[var(--text2)] font-mono whitespace-pre-wrap break-words
                              max-h-80 overflow-y-auto">
                {store.lastTranscript}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
