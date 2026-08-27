import { describe, it, expect } from 'vitest'
import {
  parseDraftHandoff,
  handoffIsRestorable,
  findTemplateById,
  EMPTY_HANDOFF,
} from '@/lib/draftHandoff'

// This module is the only durable record of what the doctor supplied between
// stopping a recording and the note appearing. It is written by one build and
// read back by another, possibly days later, so every field is untrusted on the
// way in — and the consequence of getting it wrong is a lost consultation.

describe('parseDraftHandoff', () => {
  it('reads a complete handoff', () => {
    const h = parseDraftHandoff({
      patient: 'Jane Evans',
      reg_number: '20260827001',
      session_number: '3',
      attendance: 'Attended',
      dob: '12/12/1965',
      gender: 'female',
      templateId: '1',
      templateTitle: 'Comprehensive Psychology Note',
      pendingGeneration: true,
    })
    expect(h).toEqual({
      patient: 'Jane Evans',
      reg_number: '20260827001',
      session_number: '3',
      attendance: 'Attended',
      dob: '12/12/1965',
      gender: 'female',
      templateId: '1',
      templateTitle: 'Comprehensive Psychology Note',
      pendingGeneration: true,
    })
  })

  it('rejects an array', () => {
    // typeof [] is 'object', so without the Array check this returns a handoff
    // of empty strings — which reads as "a recording with no patient" rather
    // than "no handoff", and would suppress the recovery banner.
    expect(parseDraftHandoff([])).toBeNull()
    expect(parseDraftHandoff(['Jane Evans'])).toBeNull()
  })

  it('rejects absent and non-object values', () => {
    expect(parseDraftHandoff(undefined)).toBeNull()
    expect(parseDraftHandoff(null)).toBeNull()
    expect(parseDraftHandoff('Jane Evans')).toBeNull()
    expect(parseDraftHandoff(42)).toBeNull()
  })

  it('never returns undefined for a missing field', () => {
    // undefined reaching a controlled input turns it uncontrolled mid-note, so
    // a partial handoff written by an older build must still parse to strings.
    const h = parseDraftHandoff({ patient: 'Jane Evans' })!
    expect(h.reg_number).toBe('')
    expect(h.session_number).toBe('')
    expect(h.attendance).toBe('')
    expect(h.dob).toBe('')
    expect(h.gender).toBe('')
    expect(h.templateId).toBeNull()
    expect(h.templateTitle).toBeNull()
    expect(h.pendingGeneration).toBe(false)
  })

  it('coerces a wrong-typed field rather than trusting it', () => {
    const h = parseDraftHandoff({ patient: 123, reg_number: null, attendance: {} })!
    expect(h.patient).toBe('')
    expect(h.reg_number).toBe('')
    expect(h.attendance).toBe('')
  })

  it('only accepts the two genders the app writes', () => {
    expect(parseDraftHandoff({ gender: 'male' })!.gender).toBe('male')
    expect(parseDraftHandoff({ gender: 'female' })!.gender).toBe('female')
    expect(parseDraftHandoff({ gender: 'other' })!.gender).toBe('')
    expect(parseDraftHandoff({ gender: true })!.gender).toBe('')
  })

  it('treats pendingGeneration as true only when it literally is', () => {
    // A truthy string from a hand-edited document must not be read as intent to
    // spend one of the doctor's 20 daily Gemini calls.
    expect(parseDraftHandoff({ pendingGeneration: 'yes' })!.pendingGeneration).toBe(false)
    expect(parseDraftHandoff({ pendingGeneration: 1 })!.pendingGeneration).toBe(false)
    expect(parseDraftHandoff({ pendingGeneration: true })!.pendingGeneration).toBe(true)
  })

  it('turns an empty template id into null', () => {
    expect(parseDraftHandoff({ templateId: '' })!.templateId).toBeNull()
  })
})

describe('handoffIsRestorable', () => {
  it('needs a patient name', () => {
    expect(handoffIsRestorable(parseDraftHandoff({ patient: 'Jane Evans' }))).toBe(true)
  })

  it('refuses a handoff with no name', () => {
    // Restoring nothing the doctor would notice, while showing a banner saying
    // a recording was recovered, is worse than staying quiet.
    expect(handoffIsRestorable(EMPTY_HANDOFF)).toBe(false)
    expect(handoffIsRestorable(parseDraftHandoff({ templateId: '1' }))).toBe(false)
    expect(handoffIsRestorable(parseDraftHandoff({ patient: '   ' }))).toBe(false)
    expect(handoffIsRestorable(null)).toBe(false)
  })
})

describe('findTemplateById', () => {
  // Typed the way AnyTemplate is — built-ins carry numeric ids, custom ones
  // 'custom_<timestamp>' — because that mix is the whole reason this compares
  // as strings.
  type Tpl = { id: string | number; title: string }
  const builtins: Tpl[] = [{ id: 1, title: 'Comprehensive Psychology Note' }, { id: 2, title: 'Brief' }]
  const custom: Tpl[] = [{ id: 'custom_123', title: 'My Template' }]

  it('matches a built-in whose id is a number against the stored string', () => {
    // The built-in file uses numeric ids and the handoff stores strings, so a
    // strict === would fail to resolve every built-in template.
    expect(findTemplateById('1', builtins, custom)?.title).toBe('Comprehensive Psychology Note')
  })

  it('finds a custom template', () => {
    expect(findTemplateById('custom_123', builtins, custom)?.title).toBe('My Template')
  })

  it('prefers the doctor’s own template over a built-in with the same id', () => {
    const shadowing: Tpl[] = [{ id: 1, title: 'My Edited Version' }]
    expect(findTemplateById('1', builtins, shadowing)?.title).toBe('My Edited Version')
  })

  it('returns null for a template that no longer exists', () => {
    // A deleted template must degrade to the picker, never block recovery.
    expect(findTemplateById('999', builtins, custom)).toBeNull()
  })

  it('copes with no custom templates', () => {
    expect(findTemplateById('2', builtins, undefined)?.title).toBe('Brief')
  })
})
