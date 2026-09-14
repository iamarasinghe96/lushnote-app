import { describe, expect, it } from 'vitest'
import { buildHistoryBundle, historySelectionProblem, sortHistorySources } from '@/lib/buildFromHistory'
import type { Note } from '@/types'

function note(id: string, date: string, content: string, extra: Partial<Note> = {}): Note {
  return {
    id, userId: 'u', patient: 'Test Patient', reg_number: '', date, time: '', clinician: '',
    session_number: '', attendance: '', diagnosis: '', presentation: '', history: '', medications: '',
    mse: '', content, scales: '', risk: '', referrals: '', summary: '', nextsteps: '', ...extra,
  }
}

describe('build from history', () => {
  it('orders selected sources chronologically and labels each boundary', () => {
    const result = buildHistoryBundle([
      note('later', '12/09/2026', 'Later review'),
      note('earlier', '08/09/2026', 'Admission review'),
    ])

    expect(result.indexOf('Date: 08/09/2026')).toBeLessThan(result.indexOf('Date: 12/09/2026'))
    expect(result).toContain('SOURCE 1')
    expect(result).toContain('SOURCE 2')
    expect(result).toContain('If sources conflict, preserve the discrepancy')
  })

  it('keeps stable order for documents with the same or missing dates', () => {
    const selected = [note('a', '', 'One'), note('b', '', 'Two'), note('c', 'bad', 'Three')]
    expect(sortHistorySources(selected).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('requires two documents and refuses a document with no saved text', () => {
    expect(historySelectionProblem([note('a', '01/09/2026', 'One')])).toBe('Select at least two documents')
    expect(historySelectionProblem([
      note('a', '01/09/2026', 'One'),
      note('b', '02/09/2026', ''),
    ])).toBe('One of the selected documents has no saved text')
  })

  it('uses a saved transcript when the structured document text is empty', () => {
    const result = buildHistoryBundle([
      note('a', '01/09/2026', '', { transcript: 'First source transcript' }),
      note('b', '02/09/2026', 'Second source'),
    ])
    expect(result).toContain('First source transcript')
  })

  it('refuses a bundle that cannot be retained in the saved transcript', () => {
    expect(historySelectionProblem([
      note('a', '01/09/2026', 'A'.repeat(25_000)),
      note('b', '02/09/2026', 'B'.repeat(25_000)),
    ])).toBe('This selection is too large. Choose a shorter date range.')
  })
})
