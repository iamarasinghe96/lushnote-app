import { describe, it, expect } from 'vitest'
import { SECTIONS, PINNED, OVERFLOW, isSectionKey } from '@/lib/adminSections'

// The pinned/overflow split was made for a specific reason - eleven equal tabs
// overflowed the header into a horizontal scroll and buried the five sections
// actually used - and "everything drifted back into the header" is exactly the
// kind of regression nobody files a bug for.
//
// Not tested here: that every section has a panel. The page types PANELS as
// `Record<SectionKey, ...>`, so the compiler already refuses a missing one, and
// a runtime check would only restate it.

describe('admin sections', () => {
  it('has no duplicate keys', () => {
    const keys = SECTIONS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('pins the five sections that are used day to day', () => {
    expect(PINNED.map(s => s.key)).toEqual([
      'dashboard', 'letterheads', 'billing', 'releases', 'logs',
    ])
  })

  // The header fits about six before it scrolls, which is what this split
  // exists to avoid. Six is the pinned five plus the More button itself.
  it('keeps the header short enough not to scroll', () => {
    expect(PINNED.length).toBeLessThanOrEqual(5)
  })

  it('reaches every unpinned section through More, hiding none', () => {
    expect(PINNED.length + OVERFLOW.length).toBe(SECTIONS.length)
    expect(OVERFLOW.length).toBeGreaterThan(0)
  })

  // Pinned first, because the mobile nav renders SECTIONS in order as one
  // scrolling row: the used sections should be the ones already on screen.
  it('orders pinned sections before the rest', () => {
    const firstUnpinned = SECTIONS.findIndex(s => !s.pinned)
    const lastPinned = SECTIONS.map(s => s.pinned).lastIndexOf(true)
    expect(lastPinned).toBeLessThan(firstUnpinned)
  })

  // Guards the ?section= deep link. Settings and the Users panel both build
  // these URLs by hand, and an unrecognised key silently lands on Dashboard.
  it('recognises real section keys and rejects anything else', () => {
    for (const s of SECTIONS) expect(isSectionKey(s.key)).toBe(true)
    expect(isSectionKey('nope')).toBe(false)
    expect(isSectionKey('')).toBe(false)
  })
})
