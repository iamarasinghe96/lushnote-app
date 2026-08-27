import { describe, it, expect } from 'vitest'
import {
  buildDictationTemplate,
  DICTATION_CORE_KEYS,
  OTHER_TOPICS_KEY,
  OTHER_TOPICS_LABEL,
  CATCHALL_INSTRUCTION,
} from '@/lib/dictationTemplate'
import builtins from '@/data/clinical-templates.json'
import type { AnyTemplate, TemplateSection } from '@/types'

const REAL = (builtins as AnyTemplate[]).find(t => String(t.id) === '1')!
const keysOf = (t: AnyTemplate): string[] =>
  ('sections' in t && t.sections ? t.sections : []).map((s: TemplateSection) => s.key)

describe('buildDictationTemplate', () => {
  it('starts from the real Comprehensive Psychology Note', () => {
    // Pinning the assumption the whole pathway rests on: id 1 is that template.
    expect(REAL.title).toBe('Comprehensive Psychology Note')
  })

  it('holds every topic the dictation checklist asks the doctor to cover', () => {
    // THE contract. The modal tells a doctor to dictate their medications and
    // their rating-scale scores; if the template has nowhere to put them, the
    // app asked for clinical detail it then discards. Before this, three of the
    // nine topics had no section at all.
    const keys = keysOf(buildDictationTemplate(REAL))
    for (const k of DICTATION_CORE_KEYS) expect(keys).toContain(k)
  })

  it('adds exactly the sections the base template was missing', () => {
    const before = keysOf(REAL)
    expect(before).not.toContain('medications')
    expect(before).not.toContain('scales')
    expect(before).not.toContain('referrals')

    const after = keysOf(buildDictationTemplate(REAL))
    expect(after).toContain('medications')
    expect(after).toContain('scales')
    expect(after).toContain('referrals')
  })

  it('puts new sections in canonical note order, not at the end', () => {
    // The edit page, the preview and the PDF all render in this order. A
    // Medications block appearing after Next Steps would read as a bug.
    const keys = keysOf(buildDictationTemplate(REAL)).filter(k => k !== OTHER_TOPICS_KEY)
    const expected = ['presentation', 'history', 'medications', 'mse',
                      'content', 'scales', 'risk', 'referrals', 'summary', 'nextsteps']
    expect(keys).toEqual(expected.filter(k => keys.includes(k)))
  })

  it('ends with the catch-all, and marks it as an extra', () => {
    const sections = ('sections' in buildDictationTemplate(REAL)
      ? buildDictationTemplate(REAL).sections : []) as TemplateSection[]
    const last = sections[sections.length - 1]
    expect(last.key).toBe(OTHER_TOPICS_KEY)
    expect(last.label).toBe(OTHER_TOPICS_LABEL)
    // core:false means it rides in extraSections carrying its own label, so the
    // note survives the template being deleted.
    expect(last.core).toBe(false)
  })

  it('tells the model the catch-all is a catch-all', () => {
    // buildTemplatePrompt only lists markers. A heading with no rule attached
    // gets left empty, and the spoken detail it was meant to hold is dropped.
    const t = buildDictationTemplate(REAL)
    expect(t.prompt).toContain(CATCHALL_INSTRUCTION)
    expect(t.prompt).toContain(`[${OTHER_TOPICS_KEY}]`)
  })

  it('keeps the base template’s own labels', () => {
    const t = buildDictationTemplate(REAL)
    const sections = ('sections' in t && t.sections ? t.sections : []) as TemplateSection[]
    const presentation = sections.find(s => s.key === 'presentation')!
    const original = (REAL as { sections: TemplateSection[] }).sections.find(s => s.key === 'presentation')!
    expect(presentation.label).toBe(original.label)
  })

  it('does not mutate the stored template', () => {
    // The base is the shared JSON import. Mutating it would change the template
    // every OTHER pathway hands a doctor who picked it deliberately.
    const before = keysOf(REAL).join(',')
    buildDictationTemplate(REAL)
    expect(keysOf(REAL).join(',')).toBe(before)
    expect(REAL.prompt).not.toContain(CATCHALL_INSTRUCTION)
  })

  it('never drops a section the base template carried', () => {
    const base = {
      ...REAL,
      sections: [
        { key: 'presentation', label: 'Current Presentation', core: true },
        { key: 'formulation', label: 'CBT Formulation', core: false },
      ],
    } as AnyTemplate
    // A template-specific extra must survive widening — losing it would trade
    // one kind of silent loss for another.
    expect(keysOf(buildDictationTemplate(base))).toContain('formulation')
  })

  it('is idempotent — widening twice adds one catch-all, not two', () => {
    const once = buildDictationTemplate(REAL)
    const twice = buildDictationTemplate(once)
    expect(keysOf(twice).filter(k => k === OTHER_TOPICS_KEY)).toHaveLength(1)
  })

  it('copes with a template that has no sections at all', () => {
    const bare = { id: 'x', title: 'Bare', prompt: 'Write a note.' } as unknown as AnyTemplate
    const keys = keysOf(buildDictationTemplate(bare))
    for (const k of DICTATION_CORE_KEYS) expect(keys).toContain(k)
    expect(keys).toContain(OTHER_TOPICS_KEY)
  })
})
