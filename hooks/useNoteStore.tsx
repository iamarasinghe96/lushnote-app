'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Note, NoteCreationMode, AnyTemplate, LetterType, LetterCommonFields, ReferralFields, RecordsFields, FreetextFields } from '@/types'

const DEFAULT_LETTER_COMMON: LetterCommonFields = {
  recipientName: '', recipientAddress: '', patientName: '', dob: '', letterDate: '',
}
const DEFAULT_REFERRAL: ReferralFields = {
  doctorName: '', admissionUnit: '', gender: '', admissionDateStart: '', admissionDateEnd: '',
  presentingComplaint: '', secondParagraph: '', referralReason: '', dischargeSummaryAttached: false,
  showPastMedicalHistory: false, pastMedicalHistory: '', showMedicationList: false, medicationList: '',
}
const DEFAULT_RECORDS: RecordsFields = { recordsLocation: '', secondParagraphRecords: '' }
const DEFAULT_FREETEXT: FreetextFields = { freeTextContent: '' }

interface NoteStore {
  currentNoteId: string | null
  currentNote: Partial<Note>
  lastTranscript: string | null
  lastTranscriptMode: NoteCreationMode
  lastChosenTemplate: AnyTemplate | null
  lastRecordingDuration: number
  pendingAnimation: boolean
  letterType: LetterType | null
  letterCommonFields: LetterCommonFields
  referralFields: ReferralFields
  recordsFields: RecordsFields
  freetextFields: FreetextFields
  setCurrentNote: (note: Partial<Note>) => void
  setCurrentNoteId: (id: string | null) => void
  setLastTranscript: (t: string | null) => void
  setLastTranscriptMode: (m: NoteCreationMode) => void
  setLastChosenTemplate: (t: AnyTemplate | null) => void
  setLastRecordingDuration: (s: number) => void
  setPendingAnimation: (v: boolean) => void
  setLetterType: (type: LetterType | null) => void
  setLetterCommonFields: (fields: Partial<LetterCommonFields>) => void
  setReferralFields: (fields: Partial<ReferralFields>) => void
  setRecordsFields: (fields: Partial<RecordsFields>) => void
  setFreetextFields: (fields: Partial<FreetextFields>) => void
  resetNote: () => void
  resetLetterMode: () => void
}

const NoteStoreContext = createContext<NoteStore | null>(null)

export function NoteStoreProvider({ children }: { children: ReactNode }) {
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null)
  const [currentNote, setCurrentNote] = useState<Partial<Note>>({})
  const [lastTranscript, setLastTranscript] = useState<string | null>(null)
  const [lastTranscriptMode, setLastTranscriptMode] = useState<NoteCreationMode>('paste')
  const [lastChosenTemplate, setLastChosenTemplate] = useState<AnyTemplate | null>(null)
  const [lastRecordingDuration, setLastRecordingDuration] = useState(0)
  const [pendingAnimation, setPendingAnimation] = useState(false)
  const [letterType, setLetterType] = useState<LetterType | null>(null)
  const [letterCommonFields, setLetterCommonFieldsState] = useState<LetterCommonFields>(DEFAULT_LETTER_COMMON)
  const [referralFields, setReferralFieldsState] = useState<ReferralFields>(DEFAULT_REFERRAL)
  const [recordsFields, setRecordsFieldsState] = useState<RecordsFields>(DEFAULT_RECORDS)
  const [freetextFields, setFreetextFieldsState] = useState<FreetextFields>(DEFAULT_FREETEXT)

  function resetNote() {
    setCurrentNoteId(null)
    setCurrentNote({})
    setLastTranscript(null)
    setLastTranscriptMode('paste')
    setLastChosenTemplate(null)
    setLastRecordingDuration(0)
    setPendingAnimation(false)
  }

  function resetLetterMode() {
    setLetterType(null)
    setLetterCommonFieldsState(DEFAULT_LETTER_COMMON)
    setReferralFieldsState(DEFAULT_REFERRAL)
    setRecordsFieldsState(DEFAULT_RECORDS)
    setFreetextFieldsState(DEFAULT_FREETEXT)
  }

  return (
    <NoteStoreContext.Provider value={{
      currentNoteId,
      currentNote,
      lastTranscript,
      lastTranscriptMode,
      lastChosenTemplate,
      lastRecordingDuration,
      pendingAnimation,
      letterType,
      letterCommonFields,
      referralFields,
      recordsFields,
      freetextFields,
      setCurrentNote,
      setCurrentNoteId,
      setLastTranscript,
      setLastTranscriptMode,
      setLastChosenTemplate,
      setLastRecordingDuration,
      setPendingAnimation,
      setLetterType,
      setLetterCommonFields: (fields) => setLetterCommonFieldsState(prev => ({ ...prev, ...fields })),
      setReferralFields: (fields) => setReferralFieldsState(prev => ({ ...prev, ...fields })),
      setRecordsFields: (fields) => setRecordsFieldsState(prev => ({ ...prev, ...fields })),
      setFreetextFields: (fields) => setFreetextFieldsState(prev => ({ ...prev, ...fields })),
      resetNote,
      resetLetterMode,
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
