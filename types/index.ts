// Layer 2 — all shared TypeScript interfaces

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
  transcriptPrivacy?: TranscriptPrivacy
  recordingDefaults?: RecordingDefaults
  personalisation?: Personalisation
  createdAt?: FirestoreTimestamp
  updatedAt?: FirestoreTimestamp
}

interface Workplace {
  id: string
  name: string
  type: WorkplaceType
  regSystem: 'none' | 'existing'
  regFormat?: string        // raw example ID string entered by user
  regPattern?: string       // generated regex string e.g. "^\d{8}[A-Za-z]{2}$"
  regTemplate?: string      // display template e.g. "########AA"
  themeIndex: number        // 0 = blue, 1 = purple, 2 = teal
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

// Subset used when creating or updating — omits server-managed fields
type NoteInput = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>

interface PatientProfile {
  id?: string               // Firestore document ID
  displayName: string
  dob?: string              // DD/MM/YYYY
  gender?: 'male' | 'female' | 'other' | 'prefer-not-to-say'
}

// Derived from notes — not stored in Firestore
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

interface CustomTemplate {
  id: string                // 'custom_' + timestamp
  title: string
  category: string
  description: string
  prompt: string
  custom: true
}

type AnyTemplate = Template | CustomTemplate

type NoteCreationMode =
  | 'paste'         // clipboard transcript paste
  | 'dictation'     // solo narration recording
  | 'conversation'  // in-person or telehealth recording
  | 'document'      // paste or upload .txt

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
  { primary: '#1a56db', dk: '#1347b8', lt: '#ebf0ff' },
  { primary: '#7c3aed', dk: '#6d28d9', lt: '#ede9fe' },
  { primary: '#0e9f6e', dk: '#0a7d57', lt: '#e3f9ee' },
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

// Represents firebase.firestore.Timestamp — import the real type in lib/firestore files
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
}

export { WP_THEMES }
