// Layer 2 - all shared TypeScript interfaces

interface User {
  uid: string
  email: string
  displayName: string
  credentials: string
  status: 'active' | 'pending' | 'disabled'
  tier: 'free' | 'admin'
  emailPretext: string
  activeWorkplaceId: string
  onboardingComplete: boolean
  notesMigrated: boolean
  workplaces: Workplace[]
  favoriteTemplateIds: (string | number)[]
  customTemplates: CustomTemplate[]
  groqApiKey?: string
  geminiApiKey?: string
  signatureUrl?: string
  signatureScale?: number      // percent, 50–200, default 100
  letterFontSize?: number      // pt, 9–13, default 11
  letterLineSpacing?: number   // line-height multiplier, 1.2–1.8, default 1.4
  letterMargin?: number        // side margin in mm, 10–30, default 20
  providerNumber?: string
  workPhone?: string
  position?: string
  transcriptPrivacy?: TranscriptPrivacy
  recordingDefaults?: RecordingDefaults
  personalisation?: Personalisation
  geminiUsage?: GeminiUsage
  createdAt?: FirestoreTimestamp
  updatedAt?: FirestoreTimestamp
}

type LetterType = 'referral' | 'records' | 'freetext'

interface LetterCommonFields {
  recipientName: string
  recipientAddress: string
  patientName: string
  dob: string
  letterDate: string
}

interface ReferralFields {
  doctorName: string
  admissionUnit: string
  gender: 'male' | 'female' | ''
  admissionDateStart: string
  admissionDateEnd: string
  presentingComplaint: string
  secondParagraph: string
  referralReason: string
  dischargeSummaryAttached: boolean
  showPastMedicalHistory: boolean
  pastMedicalHistory: string
  showMedicationList: boolean
  medicationList: string
}

interface RecordsFields {
  recordsLocation: string
  secondParagraphRecords: string
}

interface FreetextFields {
  freeTextContent: string
}

interface Workplace {
  id: string
  name: string
  type: WorkplaceType
  regSystem: 'none' | 'existing'
  regFormat?: string        // raw example ID string entered by user
  regPattern?: string       // generated regex string e.g. "^\d{8}[A-Za-z]{2}$"
  regTemplate?: string      // display template e.g. "########AA"
  themeIndex: number        // 0 = rose-red, 1 = indigo-blue, 2 = teal, -1 = custom
  themeColor?: string       // hex string when themeIndex === -1
}

type WorkplaceType =
  | 'Private Practice'
  | 'Hospital'
  | 'Community Mental Health'
  | 'Telehealth'
  | 'Other'

interface Note {
  id?: string               // Firestore document ID (absent before first save)
  userId: string
  patient: string
  reg_number: string
  date: string
  time: string              // e.g. "09:00 – 09:50"
  clinician: string
  session_number: string
  attendance: string
  diagnosis: string
  presentation: string
  history: string
  medications: string
  mse: string
  content: string
  scales: string
  risk: string
  referrals: string
  summary: string
  nextsteps: string
  transcript?: string
  transcriptMode?: NoteCreationMode
  createdAt?: FirestoreTimestamp
  updatedAt?: FirestoreTimestamp
}

// Subset used when creating or updating - omits server-managed fields
type NoteInput = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>

interface PatientProfile {
  id?: string               // Firestore document ID
  displayName: string
  dob?: string              // DD/MM/YYYY
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say'
}

// Derived from notes - not stored in Firestore
interface PatientSummary {
  name: string
  regNumber: string
  visitCount: number
  lastVisit?: string        // ISO date string
}

interface Template {
  id: string | number
  title: string
  category: string
  tplType: 'session' | 'document' | 'both'
  description: string
  prompt: string            // loaded from templates-prompts.json at runtime (empty string until loaded)
  custom?: false
}

interface CustomTemplateField {
  id: string
  label: string
  systemPrompt: string
  targetField: keyof Note
}

interface CustomTemplate {
  id: string                // 'custom_' + timestamp
  title: string
  category: string
  description: string
  prompt: string
  custom: true
  baseTemplateId?: string
  customFields?: CustomTemplateField[]
}

type AnyTemplate = Template | CustomTemplate

type NoteCreationMode =
  | 'paste'         // clipboard transcript paste
  | 'dictation'     // solo narration recording
  | 'conversation'  // in-person or telehealth recording
  | 'document'      // paste or upload .txt
  | 'upload'        // upload audio file (hidden in UI, code preserved)

interface GenerationRequest {
  mode: NoteCreationMode
  transcript: string
  template: AnyTemplate
  noteLength: NoteLength
  personalisation?: Personalisation
  patientInfo?: Pick<Note, 'patient' | 'reg_number' | 'date' | 'clinician'>
}

interface GenerationResponse {
  fields: Partial<Note>
  provider: 'gemini' | 'groq'
  model: string
}

interface TranscriptionResponse {
  text: string
  provider: 'gemini' | 'groq'
  model: string
}

interface Personalisation {
  useClientInfo: boolean
  noteLength: NoteLength
  professionalIdentity: string  // max 936 chars
  treatmentApproaches: string   // max 1000 chars
  documentStyle: string         // max 1000 chars
}

type NoteLength = 'brief' | 'balanced' | 'detailed'

interface TranscriptPrivacy {
  redactNames: boolean
  redactDOB: boolean
  redactOther: boolean
}

interface RecordingDefaults {
  autoStop: boolean
  autoStopMinutes: number     // 1–150
}

interface GeminiUsage {
  [modelKey: string]: {
    count: number
    date: string              // ISO date string YYYY-MM-DD
    tokens?: number           // cumulative tokens used today
  }
}

interface OnboardingState {
  step: 1 | 2 | 3 | 4 | 5
  displayName: string
  credentials: string
  workplace: Omit<Workplace, 'id'>
  emailPretext: string
  geminiApiKey: string
}

interface WorkplaceTheme {
  primary: string
  dk: string
  lt: string
}

// The three built-in themes
const WP_THEMES: readonly WorkplaceTheme[] = [
  { primary: '#e11d48', dk: '#be123c', lt: '#ffe4e6' },  // 0 = rose-red
  { primary: '#4361EE', dk: '#3451D1', lt: '#eef2ff' },  // 1 = indigo-blue
  { primary: '#0e9f6e', dk: '#0a7d57', lt: '#e3f9ee' },  // 2 = teal (unchanged)
]

interface AppState {
  currentNoteId: string | null
  allNotes: Note[]
  lastTranscript: string | null
  lastTranscriptMode: NoteCreationMode
  lastChosenTemplate: AnyTemplate | null
  patientProfiles: Record<string, PatientProfile>
  lastRecordingDuration: number       // seconds
}

type TabName = 'generate' | 'edit' | 'export' | 'history' | 'patients'
type ViewName = 'landing' | 'auth' | 'pending' | 'onboarding' | 'app'

interface DeletionFeedback {
  userId: string
  email: string
  reasons: string[]
  message: string
  deletedAt?: FirestoreTimestamp
}

// Represents firebase.firestore.Timestamp - import the real type in lib/firestore files
// This keeps types/index.ts free of Firebase imports
type FirestoreTimestamp = {
  seconds: number
  nanoseconds: number
  toDate(): Date
}

export type {
  User,
  Workplace,
  WorkplaceType,
  Note,
  NoteInput,
  PatientProfile,
  PatientSummary,
  Template,
  CustomTemplateField,
  CustomTemplate,
  AnyTemplate,
  NoteCreationMode,
  GenerationRequest,
  GenerationResponse,
  TranscriptionResponse,
  Personalisation,
  NoteLength,
  TranscriptPrivacy,
  RecordingDefaults,
  GeminiUsage,
  OnboardingState,
  WorkplaceTheme,
  AppState,
  TabName,
  ViewName,
  DeletionFeedback,
  FirestoreTimestamp,
  LetterType,
  LetterCommonFields,
  ReferralFields,
  RecordsFields,
  FreetextFields,
}

export { WP_THEMES }
