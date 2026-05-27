'use client'

import { useState, useEffect } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { applyTranscriptRedactions } from '@/lib/redact'
import { useAuth } from '@/hooks/useAuth'
import type { NoteCreationMode } from '@/types'

interface TranscriptConfirmProps {
  open: boolean
  transcript: string
  mode: NoteCreationMode
  recordingDuration?: number
  onConfirm: (editedTranscript: string) => void
  onCancel: () => void
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

const MODE_LABEL: Record<NoteCreationMode, string> = {
  paste: 'Pasted transcript',
  conversation: 'Session recording',
  dictation: 'Dictated note',
  document: 'Document',
  upload: 'Uploaded recording',
}

export default function TranscriptConfirm({
  open,
  transcript,
  mode,
  recordingDuration,
  onConfirm,
  onCancel,
}: TranscriptConfirmProps) {
  const { profile } = useAuth()
  const [text, setText] = useState(transcript)

  useEffect(() => {
    if (!open) return
    const privacy = profile?.transcriptPrivacy ?? { redactNames: false, redactDOB: false, redactOther: false }
    setText(applyTranscriptRedactions(transcript, privacy))
  }, [open, transcript, profile])

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length

  return (
    <Modal open={open} onClose={onCancel} title="Review transcript" maxWidth="lg">
      <div className="px-5 pb-5 space-y-4">
        <div className="flex items-center gap-3 text-xs text-[var(--text3)]">
          <span>{MODE_LABEL[mode]}</span>
          {recordingDuration != null && recordingDuration > 0 && (
            <>
              <span>·</span>
              <span>Recording: {formatDuration(recordingDuration)}</span>
            </>
          )}
          <span>·</span>
          <span>{wordCount} words</span>
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={14}
          className="w-full rounded-[var(--r)] border border-[var(--border)] bg-white
                     px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
                     outline-none resize-y
                     focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
                     transition-colors font-mono"
          placeholder="Transcript text will appear here…"
        />

        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} className="flex-1">Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(text)}
            disabled={!text.trim()}
            className="flex-1"
          >
            Generate note
          </Button>
        </div>
      </div>
    </Modal>
  )
}
