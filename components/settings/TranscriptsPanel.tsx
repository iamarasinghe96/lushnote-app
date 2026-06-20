'use client'

import { useState } from 'react'
import Button from '@/components/ui/Button'
import type { User, TranscriptPrivacy, RecordingDefaults } from '@/types'

interface TranscriptsPanelProps {
  profile: User
  onSave: (data: Partial<User>) => Promise<void>
  onToast: (msg: string) => void
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent
                  transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--blue)] focus:ring-offset-2
                  ${checked ? 'bg-[var(--blue)]' : 'bg-[var(--border)]'}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform
                    ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

export default function TranscriptsPanel({ profile, onSave, onToast }: TranscriptsPanelProps) {
  const [privacy, setPrivacy] = useState<TranscriptPrivacy>({
    redactNames: profile.transcriptPrivacy?.redactNames ?? true,
    redactDOB:   profile.transcriptPrivacy?.redactDOB   ?? true,
    redactOther: profile.transcriptPrivacy?.redactOther ?? true,
  })
  const [recording, setRecording] = useState<RecordingDefaults>({
    autoStop:        profile.recordingDefaults?.autoStop        ?? true,
    autoStopMinutes: profile.recordingDefaults?.autoStopMinutes ?? 90,
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ transcriptPrivacy: privacy, recordingDefaults: recording })
      onToast('Settings saved')
    } catch {
      onToast('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  function setMinutes(raw: string) {
    const n = parseInt(raw, 10)
    if (isNaN(n)) return
    setRecording(r => ({ ...r, autoStopMinutes: Math.min(150, Math.max(1, n)) }))
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Information Privacy */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Information privacy</h3>
        <p className="text-xs text-[var(--text2)] mb-4">
          These settings automatically redact identifiable information from transcripts
          before they are sent to the AI.
        </p>

        <div className="space-y-3">
          {([
            { label: "People's names", key: 'redactNames' as const },
            { label: 'Dates of birth', key: 'redactDOB' as const },
            { label: 'Other identifiable information', key: 'redactOther' as const },
          ] as const).map(row => (
            <div key={row.key} className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm text-[var(--text)]">{row.label}</span>
              <Toggle
                checked={privacy[row.key]}
                onChange={v => setPrivacy(p => ({ ...p, [row.key]: v }))}
              />
            </div>
          ))}
        </div>

        {/* Redaction preview */}
        <div className="mt-4 rounded-[var(--r)] bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
          <p className="text-xs text-[var(--text3)] mb-1">Sample redacted transcript:</p>
          <p className="text-xs font-mono text-[var(--text2)]">
            &quot;Reviewed{' '}
            <span className={privacy.redactNames ? 'bg-amber-100 text-amber-800 rounded px-0.5' : ''}>
              {privacy.redactNames ? '[NAME]' : 'John Smith'}
            </span>
            ,{' '}
            <span className={privacy.redactDOB ? 'bg-amber-100 text-amber-800 rounded px-0.5' : ''}>
              {privacy.redactDOB ? '[DOB]' : '15/04/1985'}
            </span>
            , presenting from{' '}
            <span className={privacy.redactOther ? 'bg-amber-100 text-amber-800 rounded px-0.5' : ''}>
              {privacy.redactOther ? '[ADDRESS]' : '42 Main Street'}
            </span>
            {' '}with ongoing low mood.&quot;
          </p>
        </div>
      </section>

      {/* Recording Defaults */}
      <section>
        <h3 className="text-sm font-semibold text-[var(--text)] mb-3">Recording defaults</h3>

        <div className="flex items-center justify-between gap-4 py-2">
          <div>
            <p className="text-sm text-[var(--text)]">Auto-stop recording</p>
            <p className="text-xs text-[var(--text3)]">Automatically stop the recording after a set time</p>
          </div>
          <Toggle
            checked={recording.autoStop}
            onChange={v => setRecording(r => ({ ...r, autoStop: v }))}
          />
        </div>

        {recording.autoStop && (
          <div className="flex items-center gap-3 mt-2 pl-1">
            <label className="text-sm text-[var(--text2)]">Stop after</label>
            <input
              type="number"
              min={1}
              max={150}
              value={recording.autoStopMinutes}
              onChange={e => setMinutes(e.target.value)}
              className="w-20 rounded-[var(--r)] border border-[var(--border)] bg-white
                         px-3 py-1.5 text-sm text-[var(--text)]
                         outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                         transition-colors"
            />
            <span className="text-sm text-[var(--text2)]">minutes</span>
          </div>
        )}
      </section>

      <Button variant="primary" onClick={handleSave} loading={saving}>
        Save settings
      </Button>
    </div>
  )
}
