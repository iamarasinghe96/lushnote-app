import { describe, expect, it } from 'vitest'
import { buildHistoryBundle, historySelectionProblem, historySourceFromNote, historySourcesFor, sortHistorySources, type HistorySource } from '@/lib/buildFromHistory'
import { serializeExtraSections, serializeLetterData } from '@/lib/utils'
import type { LetterData, Note } from '@/types'
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

function createdAt(at: number) {
  return { seconds: Math.floor(at / 1000), nanoseconds: 0, toDate: () => new Date(at) }
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

  // Both input streams arrive newest-first (PatientProfile.entries is documented
  // that way and listNotes orders by updatedAt desc), so a day-only sort hands
  // the model a ward round in reverse under a header promising chronology.
  it('orders same-day sources by when the patient experienced them', () => {
    const sources = historySourcesFor(
      [
        note('pm', '05/09/2026', 'Afternoon review', { time: '15:00 – 15:30' }),
        note('am', '05/09/2026', 'Morning review', { time: '09:00 – 09:50' }),
      ],
      [
        { text: 'Night ward round', at: new Date(2026, 8, 5, 22, 0).getTime() },
        { text: 'Evening ward round', at: new Date(2026, 8, 5, 19, 0).getTime() },
      ],
    )
    const result = buildHistoryBundle(sources)

    expect(result.indexOf('Morning review')).toBeLessThan(result.indexOf('Afternoon review'))
    expect(result.indexOf('Afternoon review')).toBeLessThan(result.indexOf('Evening ward round'))
    expect(result.indexOf('Evening ward round')).toBeLessThan(result.indexOf('Night ward round'))
  })

  // A note with no session time still knows when it was written. That only
  // orders it within its own day: a note typed a week after the session says
  // nothing about the session's hour.
  it('falls back to creation time within the documented day', () => {
    const result = buildHistoryBundle(historySourcesFor([
      note('second', '05/09/2026', 'Typed second', { createdAt: createdAt(new Date(2026, 8, 5, 16, 30).getTime()) }),
      note('first', '05/09/2026', 'Typed first', { createdAt: createdAt(new Date(2026, 8, 5, 8, 15).getTime()) }),
    ]))
    expect(result.indexOf('Typed first')).toBeLessThan(result.indexOf('Typed second'))
  })

  it('ignores a creation time that falls outside the documented day', () => {
    const result = buildHistoryBundle(historySourcesFor([
      // Typed up a week late, but the session was the earlier one.
      note('early-session', '01/09/2026', 'Admission review', { createdAt: createdAt(new Date(2026, 8, 8, 9, 0).getTime()) }),
      note('late-session', '05/09/2026', 'Follow-up review', { createdAt: createdAt(new Date(2026, 8, 5, 9, 0).getTime()) }),
    ]))
    expect(result.indexOf('Admission review')).toBeLessThan(result.indexOf('Follow-up review'))
  })

  it('requires two documents and refuses a document with no saved text', () => {
    expect(historySelectionProblem([source('a', '01/09/2026', 'One')])).toBe('Select at least two sources')
    expect(historySelectionProblem([
      source('a', '01/09/2026', 'One'),
      source('b', '02/09/2026', ''),
    ])).toBe('One of the selected sources has no saved text')
  })

  // Every note generated from a template carries a non-empty extraSections blob,
  // so treating that field as clinical text sends the model the demographics
  // header alone and drops the transcript that holds the actual session.
  it('uses a saved transcript when a templated note has no generated text', () => {
    const abandoned = note('a', '01/09/2026', '', {
      transcript: 'First source transcript',
      templateName: 'Progress Note',
      extraSections: serializeExtraSections([], [], { id: '42', title: 'Progress Note' }),
    })
    expect(abandoned.extraSections).toBeTruthy()

    const result = buildHistoryBundle(historySourcesFor([abandoned, note('b', '02/09/2026', 'Second source')]))
    expect(result).toContain('First source transcript')
  })

  it('uses a saved transcript when the structured document text is empty', () => {
    const result = buildHistoryBundle(historySourcesFor([
      note('a', '01/09/2026', '', { transcript: 'First source transcript' }),
      note('b', '02/09/2026', 'Second source'),
    ]))
    expect(result).toContain('First source transcript')
  })

  // Firestore documents are cast, not validated, so a legacy note can reach the
  // modal with no date at all. Two of the three readers of `date` in this module
  // already allow for that; the sort is the one that did not.
  it('survives a saved document with no date', () => {
    const undated = { ...note('a', '', 'Undated review'), date: undefined } as unknown as Note
    expect(() => historySourceFromNote(undated)).not.toThrow()
    expect(() => sortHistorySources(historySourcesFor([undated, note('b', '02/09/2026', 'Second source')]))).not.toThrow()
  })

  // The bundle tells the model the source is a Letter. Rendering it with the
  // note builder puts PATIENT/REG headers and a SESSION CONTENT heading over a
  // letter body, and loses the recipient and salutation held in letterData.
  it('renders a saved letter as a letter', () => {
    const data: LetterData = {
      common: { recipientName: 'Dr Eleanor Vance', recipientAddress: '', patientName: 'Test Patient', dob: '', letterDate: '03/09/2026' },
      freetext: { freeTextContent: 'Thank you for reviewing this patient after discharge.' },
    }
    const letter = note('letter', '03/09/2026', 'Thank you for reviewing this patient after discharge.', {
      docType: 'letter',
      letterType: 'freetext',
      letterData: serializeLetterData(data),
    })

    const result = buildHistoryBundle(historySourcesFor([letter, note('b', '04/09/2026', 'Second source')]))
    expect(result).toContain('Document type: Letter')
    expect(result).toContain('Thank you for reviewing this patient after discharge.')
    const letterSection = result.slice(result.indexOf('Document type: Letter'), result.indexOf('-----'))
    expect(letterSection).not.toContain('SESSION CONTENT')
    expect(letterSection).not.toContain('PATIENT')
  })

  it('renders a saved hospital form from the text the doctor wrote on it', () => {
    const form = note('form', '03/09/2026', 'mirrored copy', {
      docType: 'hospital-form',
      formData: JSON.stringify({
        formKey: 'awh-faw0004',
        pid: { urNo: '', surname: 'Patient', givenNames: 'Test', dob: '', sex: '' },
        noteText: 'Reviewed on the ward, settled overnight.',
        dateTime: { date: '03/09/2026', time: '09:00' },
      }),
    })

    const result = buildHistoryBundle(historySourcesFor([form, note('b', '04/09/2026', 'Second source')]))
    expect(result).toContain('Document type: Hospital form')
    expect(result).toContain('Reviewed on the ward, settled overnight.')
    expect(result.slice(0, result.indexOf('-----'))).not.toContain('SESSION CONTENT')
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

  // The advice has to name a control the doctor can actually reach: the modal is
  // a flat checkbox list with a Select all toggle and no date range anywhere.
  it('refuses a bundle that cannot be retained in the saved transcript', () => {
    expect(historySelectionProblem([
      source('a', '01/09/2026', 'A'.repeat(25_000)),
      source('b', '02/09/2026', 'B'.repeat(25_000)),
    ])).toBe('This selection is too large. Unselect some records.')
  })

  it('offers built-in and custom letters after selecting history sources', () => {
    const page = readFileSync('app/(app)/patients/page.tsx', 'utf8')
    expect(page).toContain('onSelectLetter={type => startLetterFromHistory(type)}')
    expect(page).toContain("onSelectCustomLetter={template => startLetterFromHistory('custom', template)}")
    expect(page).toContain('store.setLastTranscript(buildHistoryBundle(historySources))')
    expect(page).toContain('store.setPendingLetterGeneration(true)')
  })
})
