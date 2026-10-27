import { describe, it, expect } from 'vitest'
import { stagingDatabase, provisionHere } from '@/lib/stagingDatabase'

// The Releases panel's answer to "is staging on its own database?". A wrong
// "separate" would hide the one warning that says staging is writing to live
// doctors' records, so every shape is pinned.

describe('stagingDatabase', () => {
  it('reports separate projects as separate', () => {
    expect(stagingDatabase('lush-note', 'lush-note-staging'))
      .toEqual({ state: 'separate', staging: 'lush-note-staging', live: 'lush-note' })
  })

  it('reports the same project as shared', () => {
    expect(stagingDatabase('lush-note', 'lush-note')).toEqual({ state: 'shared', project: 'lush-note' })
  })

  it('does not guess when either side cannot say', () => {
    expect(stagingDatabase(null, 'lush-note-staging')).toEqual({ state: 'unknown' })
    expect(stagingDatabase('lush-note', undefined)).toEqual({ state: 'unknown' })
    expect(stagingDatabase('lush-note', '  ')).toEqual({ state: 'unknown' })
  })
})

describe('provisionHere', () => {
  const separate = stagingDatabase('lush-note', 'lush-note-staging')

  it('sends the live console to staging once staging is separate', () => {
    expect(provisionHere(separate, 'lush-note')).toBe(false)
  })

  it('provisions on the staging console', () => {
    expect(provisionHere(separate, 'lush-note-staging')).toBe(true)
  })

  it('keeps the button wherever staging is shared or unknown', () => {
    expect(provisionHere(stagingDatabase('lush-note', 'lush-note'), 'lush-note')).toBe(true)
    expect(provisionHere({ state: 'unknown' }, 'lush-note')).toBe(true)
  })
})
