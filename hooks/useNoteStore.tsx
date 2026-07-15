'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Note, NoteCreationMode, AnyTemplate, LetterType, LetterCommonFields, ReferralFields, RecordsFields, FreetextFields } from '@/types'
import type { LetterheadDoc } from '@/lib/firestore/letterheads'

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
  lastRecordingEndTime: number
  pendingAnimation: boolean
  // Land on the edit page and persist the note WITH its transcript but WITHOUT
  // running AI generation — used when a captured transcript failed the clinical-
  // content check but must never be discarded. The doctor gets it saved under
  // the patient with a "Generate note" button to run generation on demand.
  pendingTranscriptOnly: boolean
  overrideNoteLength: 'brief' | 'balanced' | 'detailed' | null
  pendingPatientProfile: { dob: string; gender: 'male' | 'female' | '' } | null
  incompleteTranscript: boolean
  activeLetterhead: LetterheadDoc | null
  letterType: LetterType | null
  pendingLetterGeneration: boolean
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
  setLastRecordingEndTime: (t: number) => void
  setPendingAnimation: (v: boolean) => void
  setPendingTranscriptOnly: (v: boolean) => void
  setOverrideNoteLength: (v: 'brief' | 'balanced' | 'detailed' | null) => void
  setPendingPatientProfile: (v: { dob: string; gender: 'male' | 'female' | '' } | null) => void
  setIncompleteTranscript: (v: boolean) => void
  setActiveLetterhead: (lh: LetterheadDoc | null) => void
  setLetterType: (type: LetterType | null) => void
  setPendingLetterGeneration: (v: boolean) => void
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
  const [lastRecordingEndTime, setLastRecordingEndTime] = useState(0)
  const [pendingAnimation, setPendingAnimation] = useState(false)
  const [pendingTranscriptOnly, setPendingTranscriptOnly] = useState(false)
  const [overrideNoteLength, setOverrideNoteLength] = useState<'brief' | 'balanced' | 'detailed' | null>(null)
  const [pendingPatientProfile, setPendingPatientProfile] = useState<{ dob: string; gender: 'male' | 'female' | '' } | null>(null)
  const [incompleteTranscript, setIncompleteTranscript] = useState(false)
  const [activeLetterhead, setActiveLetterhead] = useState<LetterheadDoc | null>(null)
  const [letterType, setLetterType] = useState<LetterType | null>(null)
  const [pendingLetterGeneration, setPendingLetterGeneration] = useState(false)
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
    setLastRecordingEndTime(0)
    setPendingAnimation(false)
    setPendingTranscriptOnly(false)
    setIncompleteTranscript(false)
  }

  function resetLetterMode() {
    setLetterType(null)
    setPendingLetterGeneration(false)
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
      lastRecordingEndTime,
      pendingAnimation,
      pendingTranscriptOnly,
      setPendingTranscriptOnly,
      overrideNoteLength,
      setOverrideNoteLength,
      pendingPatientProfile,
      setPendingPatientProfile,
      incompleteTranscript,
      setIncompleteTranscript,
      activeLetterhead,
      setActiveLetterhead,
      letterType,
      pendingLetterGeneration,
      setPendingLetterGeneration,
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
      setLastRecordingEndTime,
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
