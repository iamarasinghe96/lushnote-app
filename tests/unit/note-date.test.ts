import { describe, expect, it } from 'vitest'
import { compareNoteDatesDesc, isLaterNoteDate, noteDateValue } from '@/lib/noteDate'

// Note dates are DD/MM/YYYY strings. Every chronology in the editor and History
// used to compare them as strings, which orders by day of the month.

describe('reading a note date', () => {
  it('reads DD/MM/YYYY, with or without leading zeros', () => {
    expect(noteDateValue('01/02/2026')).toBe(20260201)
    expect(noteDateValue('1/2/2026')).toBe(20260201)
  })

  it('reads nothing from a blank or malformed date', () => {
    expect(noteDateValue('')).toBeNull()
    expect(noteDateValue(undefined)).toBeNull()
    expect(noteDateValue('2026-02-01')).toBeNull()
    expect(noteDateValue('13/13/2026')).toBeNull()
  })
})

describe('ordering note dates', () => {
  // THE BUG: as strings, "31/01" sorts after "01/02".
  it('knows February comes after the last day of January', () => {
    expect('31/01/2026' > '01/02/2026').toBe(true)
    expect(isLaterNoteDate('01/02/2026', '31/01/2026')).toBe(true)
    expect(isLaterNoteDate('31/01/2026', '01/02/2026')).toBe(false)
  })

  it('knows a new year comes after December', () => {
    expect(isLaterNoteDate('02/01/2026', '28/12/2025')).toBe(true)
  })

  it('sorts newest first, undated last', () => {
    const dates = ['31/01/2026', '', '01/02/2026', '15/12/2025', 'not a date']
    expect([...dates].sort(compareNoteDatesDesc)).toEqual(['01/02/2026', '31/01/2026', '15/12/2025', '', 'not a date'])
  })

  it('never treats an unreadable date as later than a real one', () => {
    expect(isLaterNoteDate('', '01/02/2026')).toBe(false)
    expect(isLaterNoteDate('01/02/2026', '')).toBe(true)
  })
})
