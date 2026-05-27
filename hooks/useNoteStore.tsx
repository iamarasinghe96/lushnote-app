'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Note, NoteCreationMode, AnyTemplate } from '@/types'

interface NoteStore {
  currentNoteId: string | null
  currentNote: Partial<Note>
  lastTranscript: string | null
  lastTranscriptMode: NoteCreationMode
  lastChosenTemplate: AnyTemplate | null
  lastRecordingDuration: number
  setCurrentNote: (note: Partial<Note>) => void
  setCurrentNoteId: (id: string | null) => void
  setLastTranscript: (t: string | null) => void
  setLastTranscriptMode: (m: NoteCreationMode) => void
  setLastChosenTemplate: (t: AnyTemplate | null) => void
  setLastRecordingDuration: (s: number) => void
  resetNote: () => void
}

const NoteStoreContext = createContext<NoteStore | null>(null)

export function NoteStoreProvider({ children }: { children: ReactNode }) {
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [currentNote, setCurrentNote] = useState<Partial<Note>>({})
  const [lastTranscript, setLastTranscript] = useState<string | null>(null)
  const [lastTranscriptMode, setLastTranscriptMode] = useState<NoteCreationMode>('paste')
  const [lastChosenTemplate, setLastChosenTemplate] = useState<AnyTemplate | null>(null)
  const [lastRecordingDuration, setLastRecordingDuration] = useState(0)

  function resetNote() {
    setCurrentNoteId(null)
    setCurrentNote({})
    setLastTranscript(null)
    setLastTranscriptMode('paste')
    setLastChosenTemplate(null)
    setLastRecordingDuration(0)
  }

  return (
    <NoteStoreContext.Provider value={{
      currentNoteId,
      currentNote,
      lastTranscript,
      lastTranscriptMode,
      lastChosenTemplate,
      lastRecordingDuration,
      setCurrentNote,
      setCurrentNoteId,
      setLastTranscript,
      setLastTranscriptMode,
      setLastChosenTemplate,
      setLastRecordingDuration,
      resetNote,
    }}>
      {children}
    </NoteStoreContext.Provider>
  )
}

export function useNoteStore(): NoteStore {
  const ctx = useContext(NoteStoreContext)
  if (!ctx) throw new Error('useNoteStore must be used within NoteStoreProvider')
  return ctx
}
