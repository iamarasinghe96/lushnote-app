'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Note, NoteCreationMode, AnyTemplate, LetterType, LetterCommonFields, ReferralFields, RecordsFields, FreetextFields } from '@/types'
import type { LetterheadDoc } from '@/lib/firestore/letterheads'

const DEFAULT_LETTER_COMMON: LetterCommonFields = {
  recipientName: '',
  recipientAddress: '',
  patientName: '',
  dob: '',
  letterDate: '',
}

const DEFAULT_REFERRAL: ReferralFields = {
  doctorName: '',
  admissionUnit: '',
  gender: '',
  admissionDateStart: '',
  admissionDateEnd: '',
  presentingComplaint: '',
  secondParagraph: '',
  referralReason: '',
  dischargeSummaryAttached: false,
  showPastMedicalHistory: false,
  pastMedicalHistory: '',
  showMedicationList: false,
  medicationList: '',
}

const DEFAULT_RECORDS: RecordsFields = {
  recordsLocation: '',
  secondParagraphRecords: '',
}

const DEFAULT_FREETEXT: FreetextFields = {
  freeTextContent: '',
}

interface NoteStore {
  currentNoteId: string | null
  currentNote: Partial<Note>
  lastTranscript: string | null
  lastTranscriptMode: NoteCreationMode
  lastChosenTemplate: AnyTemplate | null
  lastRecordingDuration: number
  pendingAnimation: boolean
  activeLetterhead: LetterheadDoc | null
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
  setActiveLetterhead: (lh: LetterheadDoc | null) => void
  setLetterType: (type: LetterType | null) => void
  setLetterCommonFields: (fields: Partial<LetterCommonFields>) => void
  setReferralFields: (fields: Partial<ReferralFields>) => void
  setRecordsFields: (fields: Partial<RecordsFields>) => void
  setFreetextFields: (fields: Partial<FreetextFields>) => void
  resetLetterMode: () => void
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
  const [pendingAnimation, setPendingAnimation] = useState(false)
  const [activeLetterhead, setActiveLetterhead] = useState<LetterheadDoc | null>(null)
  const [letterType, setLetterType] = useState<LetterType | null>(null)
  const [letterCommonFields, setLetterCommonFieldsState] = useState<LetterCommonFields>(DEFAULT_LETTER_COMMON)
  const [referralFields, setReferralFieldsState] = useState<ReferralFields>(DEFAULT_REFERRAL)
  const [recordsFields, setRecordsFieldsState] = useState<RecordsFields>(DEFAULT_RECORDS)
  const [freetextFields, setFreetextFieldsState] = useState<FreetextFields>(DEFAULT_FREETEXT)

  function setLetterCommonFields(fields: Partial<LetterCommonFields>) {
    setLetterCommonFieldsState(prev => ({ ...prev, ...fields }))
  }
  function setReferralFields(fields: Partial<ReferralFields>) {
    setReferralFieldsState(prev => ({ ...prev, ...fields }))
  }
  function setRecordsFields(fields: Partial<RecordsFields>) {
    setRecordsFieldsState(prev => ({ ...prev, ...fields }))
  }
  function setFreetextFields(fields: Partial<FreetextFields>) {
    setFreetextFieldsState(prev => ({ ...prev, ...fields }))
  }

  function resetLetterMode() {
    setLetterType(null)
    setLetterCommonFieldsState(DEFAULT_LETTER_COMMON)
    setReferralFieldsState(DEFAULT_REFERRAL)
    setRecordsFieldsState(DEFAULT_RECORDS)
    setFreetextFieldsState(DEFAULT_FREETEXT)
  }

  function resetNote() {
    setCurrentNoteId(null)
    setCurrentNote({})
    setLastTranscript(null)
    setLastTranscriptMode('paste')
    setLastChosenTemplate(null)
    setLastRecordingDuration(0)
    setPendingAnimation(false)
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
      activeLetterhead,
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
      setActiveLetterhead,
      setLetterType,
      setLetterCommonFields,
      setReferralFields,
      setRecordsFields,
      setFreetextFields,
      resetLetterMode,
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
