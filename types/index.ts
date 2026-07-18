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
  customLetterTemplates?: CustomLetterTemplate[]  // array order = picker priority
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
  termsAccepted?: boolean
  termsAcceptedAt?: string
  createdAt?: FirestoreTimestamp
  updatedAt?: FirestoreTimestamp
}

type LetterType = 'referral' | 'records' | 'freetext' | 'custom'

// A doctor-defined letter type, saved privately to their own profile. Each
// section is one topic the letter covers; `prompt` is the AI-refined guidance
// used to extract the doctor's dictation into those sections.
interface CustomLetterSection {
  key: string       // slug of the heading, used as the extraction field key
  heading: string   // display label
  description: string
}
interface CustomLetterTemplate {
  id: string        // 'ltr_' + timestamp
  title: string
  description: string
  sections: CustomLetterSection[]
  prompt: string
}

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
  // Serialized JSON of template-specific sections that don't map to a core field
  // above, plus the full section render order. Shape (see lib/utils serialize/parse
  // helpers): { order: string[]; extras: ExtraSection[] }. Absent on notes created
  // before template-aware sections existed — renderers fall back to canonical order.
  extraSections?: string
  transcript?: string
  transcriptMode?: NoteCreationMode
  // Letter persistence. A progress_notes doc with docType 'letter' is a saved,
  // AI-generated letter rather than a clinical note. `letterType` is the kind of
  // letter and `letterData` is the serialized LetterData payload (recipient +
  // per-section content) used to re-open it in the letter editor. The assembled
  // plain-text letter body is also mirrored into `content` so the Patients list,
  // History preview and AI assistant treat it exactly like a note. Absent on
  // clinical notes (docType absent = note).
  docType?: 'note' | 'letter' | 'hospital-form'
  letterType?: LetterType
  letterData?: string
  // Hospital progress-note form persistence. A progress_notes doc with docType
  // 'hospital-form' is a filled hospital form (e.g. AWH FAW0004) rather than a
  // clinical note or letter. `formData` is the serialized HospitalFormData used
  // to re-open it in the form editor; the entry text is also mirrored into
  // `content` so it lists/searches like any note. Absent on notes/letters.
  formData?: string
  createdAt?: FirestoreTimestamp
  updatedAt?: FirestoreTimestamp
}

// Geometry of a hospital form, in millimetres, so the editor and PDF render at
// any hospital's layout without code changes. Cloned defaults come from the AWH
// FAW0004 form; a new hospital supplies its own via the admin panel.
interface HospitalFormGeometry {
  tableTopMm: number
  tableLeftMm: number
  dateColMm: number
  notesColMm: number
  rowHeightMm: number
  rowsPerPage: number
  fontPt: number
  pid: {
    topMm: number
    leftMm: number
    widthMm: number
    rowHeightMm: number
    dobSexGapMm: number
    sexWidthMm: number
  }
}

// A hospital's fillable form definition. Private config, admin-managed, gated to
// the campuses in `organizationKeys` (toOrganizationKey of the workplace name).
interface HospitalFormDoc {
  formKey: string                 // slug id, e.g. 'awh-faw0004'
  name: string                    // display name, e.g. 'AWH Progress Notes (FAW0004)'
  organizationKeys: string[]      // workplace keys allowed to see this form
  pageBackgrounds: string[]       // public Storage URLs, one full-page PNG per side
  geometry: HospitalFormGeometry
  labels: { dateCol: string; notesCol: string }
}

// The filled-in state of a hospital form (serialized into Note.formData). The
// doctor edits plain fields; `noteText` is free text (like a free-text letter),
// wrapped onto the form's ruled lines only at export/preview time.
interface HospitalFormData {
  formKey: string
  pid: { urNo: string; surname: string; givenNames: string; dob: string; sex: string }
  noteText: string
  dateTime: { date: string; time: string }
}

// Structured payload of a saved letter (serialized into Note.letterData). Carries
// the recipient/patient common fields plus whichever type-specific fields the
// letter uses. For custom letters the template is snapshotted so the letter still
// renders after the doctor edits or deletes that template.
interface LetterData {
  common: LetterCommonFields
  referral?: ReferralFields
  records?: RecordsFields
  freetext?: FreetextFields
  customTemplate?: CustomLetterTemplate
  customSections?: { key: string; heading: string; content: string }[]
}

// A template section that has no core-field equivalent (e.g. "CBT Formulation",
// "Core Beliefs"). Stored on the note WITH its label so old notes survive the
// template being edited or deleted.
interface ExtraSection {
  key: string
  label: string
  content: string
}

// A template's declared section (core = fills one of the 11 Note fields above;
// otherwise an extra section rendered as its own field in template order).
interface TemplateSection {
  key: string
  label: string
  core: boolean
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
  sections?: TemplateSection[]  // precomputed section metadata (annotate-template-sections.mjs)
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
  sections?: TemplateSection[]
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
  ExtraSection,
  TemplateSection,
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
  CustomLetterSection,
  CustomLetterTemplate,
  LetterData,
  HospitalFormGeometry,
  HospitalFormDoc,
  HospitalFormData,
}

export { WP_THEMES }
