import { describe, expect, it } from 'vitest'
import { buildHistoryBundle, historySelectionProblem, historySourcesFor, sortHistorySources, type HistorySource } from '@/lib/buildFromHistory'
import type { Note } from '@/types'
import { readFileSync } from 'node:fs'

function note(id: string, date: string, content: string, extra: Partial<Note> = {}): Note {
  return {
    id, userId: 'u', patient: 'Test Patient', reg_number: '', date, time: '', clinician: '',
    session_number: '', attendance: '', diagnosis: '', presentation: '', history: '', medications: '',
    mse: '', content, scales: '', risk: '', referrals: '', summary: '', nextsteps: '', ...extra,
  }
}

function source(id: string, date: string, text: string): HistorySource {
  return { id, date, text, documentType: 'Clinical note' }
}

describe('build from history', () => {
  it('orders selected sources chronologically and labels each boundary', () => {
    const result = buildHistoryBundle([
      source('later', '12/09/2026', 'Later review'),
      source('earlier', '08/09/2026', 'Admission review'),
    ])

    expect(result.indexOf('Date: 08/09/2026')).toBeLessThan(result.indexOf('Date: 12/09/2026'))
    expect(result).toContain('SOURCE 1')
    expect(result).toContain('SOURCE 2')
    expect(result).toContain('If sources conflict, preserve the discrepancy')
  })

  it('keeps stable order for documents with the same or missing dates', () => {
    const selected = [source('a', '', 'One'), source('b', '', 'Two'), source('c', 'bad', 'Three')]
    expect(sortHistorySources(selected).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('requires two documents and refuses a document with no saved text', () => {
    expect(historySelectionProblem([source('a', '01/09/2026', 'One')])).toBe('Select at least two sources')
    expect(historySelectionProblem([
      source('a', '01/09/2026', 'One'),
      source('b', '02/09/2026', ''),
    ])).toBe('One of the selected sources has no saved text')
  })

  it('uses a saved transcript when the structured document text is empty', () => {
    const result = buildHistoryBundle(historySourcesFor([
      note('a', '01/09/2026', '', { transcript: 'First source transcript' }),
      note('b', '02/09/2026', 'Second source'),
    ]))
    expect(result).toContain('First source transcript')
  })

  it('includes each Add to patient record entry as its own selectable source', () => {
    const sources = historySourcesFor([], [
      { text: 'Later ward round', at: new Date(2026, 8, 5).getTime() },
      { text: 'Admission ward note', at: new Date(2026, 8, 1).getTime() },
    ])

    expect(sources).toHaveLength(2)
    expect(sources.every(item => item.documentType === 'Patient record')).toBe(true)
    const result = buildHistoryBundle(sources)
    expect(result).toContain('Document type: Patient record')
    expect(result.indexOf('Admission ward note')).toBeLessThan(result.indexOf('Later ward round'))
  })

  it('refuses a bundle that cannot be retained in the saved transcript', () => {
    expect(historySelectionProblem([
      source('a', '01/09/2026', 'A'.repeat(25_000)),
      source('b', '02/09/2026', 'B'.repeat(25_000)),
    ])).toBe('This selection is too large. Choose a shorter date range.')
  })

  it('offers built-in and custom letters after selecting history sources', () => {
    const page = readFileSync('app/(app)/patients/page.tsx', 'utf8')
    expect(page).toContain('onSelectLetter={type => startLetterFromHistory(type)}')
    expect(page).toContain("onSelectCustomLetter={template => startLetterFromHistory('custom', template)}")
    expect(page).toContain('store.setLastTranscript(buildHistoryBundle(historySources))')
    expect(page).toContain('store.setPendingLetterGeneration(true)')
  })
})
