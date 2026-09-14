import { describe, expect, it } from 'vitest'
import builtins from '@/data/clinical-templates.json'
import type { AnyTemplate, TemplateSection } from '@/types'

const discharge = (builtins as AnyTemplate[]).find(template => String(template.id) === '117')

function sections(): TemplateSection[] {
  return discharge && 'sections' in discharge && discharge.sections ? discharge.sections : []
}

describe('Discharge Note built-in template', () => {
  it('is a document template available in the full built-in picker', () => {
    expect(discharge).toMatchObject({ title: 'Discharge Note', category: 'Progress Notes', tplType: 'document' })
  })

  it('maps the patient record topics into discharge-note order', () => {
    expect(sections().map(section => section.key)).toEqual([
      'diagnosis', 'presentation', 'history', 'content', 'medications',
      'mse', 'risk', 'summary', 'referrals', 'nextsteps',
    ])
  })

  it('omits unsupported topics rather than manufacturing discharge content', () => {
    expect(discharge?.prompt).toContain('Use only explicitly documented facts')
    expect(discharge?.prompt).toContain('Do not write a salutation, sign-off or letter to a referrer')
    for (const section of sections()) {
      const marker = `[${section.key}] ${section.label}`
      const start = discharge!.prompt.indexOf(marker)
      expect(start).toBeGreaterThan(-1)
      expect(discharge!.prompt.slice(start, start + 700)).toContain('Omit this entire section when')
    }
  })
})
