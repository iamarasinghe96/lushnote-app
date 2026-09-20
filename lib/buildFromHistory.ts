import type { Note, PatientEntry } from '@/types'
import { buildLetterText, buildNoteText, parseHospitalFormData, parseLetterData } from '@/lib/utils'

export interface HistorySource {
  id: string
  date: string
  documentType: 'Clinical note' | 'Letter' | 'Hospital form' | 'Patient record'
  templateName?: string
  text: string
  // When the source was recorded, epoch ms. `date` alone puts every document on
  // the same day at midnight, and both input streams arrive newest-first, so a
  // ward round would reach the model backwards. Absent when nothing more precise
  // than the day is known.
  at?: number
}

// The generated note stores this bundle in its 50,000-character transcript
// field. Refusing a larger selection keeps every chosen source available there
// instead of making the saved provenance a silent prefix of what the model saw.
export const MAX_HISTORY_SOURCE_CHARS = 48_000

const DOCUMENT_LABEL: Record<NonNullable<Note['docType']> | 'note', Exclude<HistorySource['documentType'], 'Patient record'>> = {
  note: 'Clinical note',
  letter: 'Letter',
  'hospital-form': 'Hospital form',
}

const DAY_MS = 24 * 60 * 60 * 1000

function dateValue(value: string | undefined): number | null {
  const match = (value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date.getTime()
}

// The day the doctor documented, refined by `at` when that timestamp falls
// inside it. A note typed up a week after the session carries a creation time
// that says nothing about when the session happened, so there only the day counts.
function sortValue(source: HistorySource): number | null {
  const day = dateValue(source.date)
  if (source.at === undefined) return day
  if (day === null) return source.at
  return source.at >= day && source.at < day + DAY_MS ? source.at : day
}

export function sortHistorySources(sources: readonly HistorySource[]): HistorySource[] {
  return sources.map((source, index) => ({ source, index }))
    .sort((a, b) => {
      const left = sortValue(a.source)
      const right = sortValue(b.source)
      if (left === null && right === null) return a.index - b.index
      if (left === null) return -1
      if (right === null) return 1
      return left - right || a.index - b.index
    })
    .map(item => item.source)
}

// Only real clinical prose counts. `extraSections` is a serialised blob that is
// non-empty for every note generated with a template, so including it made the
// transcript fallback below unreachable: a note whose generation failed reached
// the model as its demographics header alone.
function noteText(note: Note): string {
  if (note.docType === 'letter') {
    const data = parseLetterData(note.letterData)
    if (data && note.letterType) {
      return buildLetterText({
        letterType: note.letterType,
        common: data.common,
        referral: data.referral,
        records: data.records,
        freetext: data.freetext,
        customSections: data.customSections,
      }).trim()
    }
    // Letters saved before letterData existed only have the mirrored body.
    return note.content?.trim() || note.transcript?.trim() || ''
  }

  if (note.docType === 'hospital-form') {
    const form = parseHospitalFormData(note.formData)
    return form?.noteText.trim() || note.content?.trim() || ''
  }

  const clinicalKeys: Array<keyof Note> = [
    'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content',
    'scales', 'risk', 'referrals', 'summary', 'nextsteps',
  ]
  const hasStructuredText = clinicalKeys.some(key => {
    const value = note[key]
    return typeof value === 'string' && value.trim().length > 0
  })
  return hasStructuredText ? buildNoteText(note).trim() : note.transcript?.trim() || ''
}

// The start of the session, from `Note.time` ("09:00 - 09:50", written with
// either dash). Failing that, when the note was written.
function noteAt(note: Note): number | undefined {
  const day = dateValue(note.date)
  const match = note.time?.trim().match(/^(\d{1,2}):(\d{2})/)
  if (day !== null && match) return day + Number(match[1]) * 60 * 60 * 1000 + Number(match[2]) * 60 * 1000
  const seconds = note.createdAt?.seconds
  return typeof seconds === 'number' ? seconds * 1000 : undefined
}

export function historySourceFromNote(note: Note): HistorySource | null {
  if (!note.id) return null
  const at = noteAt(note)
  return {
    id: `document:${note.id}`,
    date: note.date,
    documentType: DOCUMENT_LABEL[note.docType ?? 'note'],
    ...(note.templateName ? { templateName: note.templateName } : {}),
    ...(at === undefined ? {} : { at }),
    text: noteText(note),
  }
}

function entryDate(at: number): string {
  const date = new Date(at)
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

export function historySourcesFor(notes: readonly Note[], entries: readonly PatientEntry[] = []): HistorySource[] {
  const documents = notes.map(historySourceFromNote).filter((source): source is HistorySource => source !== null)
  const records = entries.map((entry, index) => ({
    id: `patient-record:${entry.at}:${index}`,
    date: entryDate(entry.at),
    documentType: 'Patient record' as const,
    at: entry.at,
    text: entry.text.trim(),
  }))
  return [...documents, ...records].filter(source => !!source.text)
}

export function buildHistoryBundle(input: readonly HistorySource[]): string {
  const sources = sortHistorySources(input)
  const header = [
    'BUILD FROM HISTORY SOURCE BUNDLE',
    'The doctor deliberately selected the source documents below.',
    'Use only information documented in these sources. Do not infer missing facts.',
    'If sources conflict, preserve the discrepancy for the doctor to resolve rather than choosing one version.',
    'Treat source dates as chronology, not as proof that a condition or medication remained current.',
  ].join('\n')

  const documents = sources.map((note, index) => {
    const metadata = [
      `SOURCE ${index + 1}`,
      `Date: ${note.date || 'Not documented'}`,
      `Document type: ${note.documentType}`,
      note.templateName ? `Template: ${note.templateName}` : '',
    ].filter(Boolean).join('\n')
    return `${metadata}\n\n${note.text || 'No document text was saved.'}`
  })

  return `${header}\n\n${documents.join('\n\n-----\n\n')}`
}

export function historySelectionProblem(sources: readonly HistorySource[]): string | null {
  if (sources.length < 2) return 'Select at least two sources'
  if (sources.some(source => !source.text.trim())) return 'One of the selected sources has no saved text'
  if (buildHistoryBundle(sources).length > MAX_HISTORY_SOURCE_CHARS) {
    return 'This selection is too large. Unselect some records.'
  }
  return null
}
