import type { Note } from '@/types'
import { buildNoteText } from '@/lib/utils'

// The generated note stores this bundle in its 50,000-character transcript
// field. Refusing a larger selection keeps every chosen source available there
// instead of making the saved provenance a silent prefix of what the model saw.
export const MAX_HISTORY_SOURCE_CHARS = 48_000

const DOCUMENT_LABEL: Record<NonNullable<Note['docType']> | 'note', string> = {
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

export function sortHistorySources(notes: readonly Note[]): Note[] {
  return notes.map((note, index) => ({ note, index }))
    .sort((a, b) => {
      const left = dateValue(a.note.date)
      const right = dateValue(b.note.date)
      if (left === null && right === null) return a.index - b.index
      if (left === null) return -1
      if (right === null) return 1
      return left - right || a.index - b.index
    })
    .map(item => item.note)
}

export function historySourceText(note: Note): string {
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

export function buildHistoryBundle(notes: readonly Note[]): string {
  const sources = sortHistorySources(notes)
  const header = [
    'BUILD FROM HISTORY SOURCE BUNDLE',
    'The doctor deliberately selected the source documents below.',
    'Use only information documented in these sources. Do not infer missing facts.',
    'If sources conflict, preserve the discrepancy for the doctor to resolve rather than choosing one version.',
    'Treat source dates as chronology, not as proof that a condition or medication remained current.',
  ].join('\n')

  const documents = sources.map((note, index) => {
    const label = DOCUMENT_LABEL[note.docType ?? 'note']
    const metadata = [
      `SOURCE ${index + 1}`,
      `Date: ${note.date || 'Not documented'}`,
      `Document type: ${label}`,
      note.templateName ? `Template: ${note.templateName}` : '',
    ].filter(Boolean).join('\n')
    return `${metadata}\n\n${historySourceText(note) || 'No document text was saved.'}`
  })

  return `${header}\n\n${documents.join('\n\n-----\n\n')}`
}

export function historySelectionProblem(notes: readonly Note[]): string | null {
  if (notes.length < 2) return 'Select at least two documents'
  if (notes.some(note => !historySourceText(note))) return 'One of the selected documents has no saved text'
  if (buildHistoryBundle(notes).length > MAX_HISTORY_SOURCE_CHARS) {
    return 'This selection is too large. Choose a shorter date range.'
  }
  return null
}
