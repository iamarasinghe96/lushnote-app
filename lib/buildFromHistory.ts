import type { Note, PatientEntry } from '@/types'
import { buildNoteText } from '@/lib/utils'

export interface HistorySource {
  id: string
  date: string
  documentType: 'Clinical note' | 'Letter' | 'Hospital form' | 'Patient record'
  templateName?: string
  text: string
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

function dateValue(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date.getTime()
}

export function sortHistorySources(sources: readonly HistorySource[]): HistorySource[] {
  return sources.map((source, index) => ({ source, index }))
    .sort((a, b) => {
      const left = dateValue(a.source.date)
      const right = dateValue(b.source.date)
      if (left === null && right === null) return a.index - b.index
      if (left === null) return -1
      if (right === null) return 1
      return left - right || a.index - b.index
    })
    .map(item => item.source)
}

function noteText(note: Note): string {
  const clinicalKeys: Array<keyof Note> = [
    'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content',
    'scales', 'risk', 'referrals', 'summary', 'nextsteps', 'extraSections',
  ]
  const hasStructuredText = clinicalKeys.some(key => {
    const value = note[key]
    return typeof value === 'string' && value.trim().length > 0
  })
  return hasStructuredText ? buildNoteText(note).trim() : note.transcript?.trim() || ''
}

export function historySourceFromNote(note: Note): HistorySource | null {
  if (!note.id) return null
  return {
    id: `document:${note.id}`,
    date: note.date,
    documentType: DOCUMENT_LABEL[note.docType ?? 'note'],
    ...(note.templateName ? { templateName: note.templateName } : {}),
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
    return 'This selection is too large. Choose a shorter date range.'
  }
  return null
}
