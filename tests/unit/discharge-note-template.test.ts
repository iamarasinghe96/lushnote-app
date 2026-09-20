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

  // Sliced to the NEXT section marker, not to a fixed width. Every block in this
  // prompt is shorter than 400 characters, so a fixed window spills into its
  // neighbour and nine of the ten sections go unchecked: [mse] carries the
  // clause mid-sentence as "and omit this entire section when", which a
  // case-sensitive assertion misses, and the test passed anyway on [risk]'s copy.
  it('omits unsupported topics rather than manufacturing discharge content', () => {
    expect(discharge?.prompt).toContain('Use only explicitly documented facts')
    expect(discharge?.prompt).toContain('Do not write a salutation, sign-off or letter to a referrer')

    const prompt = discharge!.prompt
    const markers = sections()
      .map(section => ({ key: section.key, start: prompt.indexOf(`[${section.key}] ${section.label}`) }))
    for (const marker of markers) expect(marker.start).toBeGreaterThan(-1)

    const boundaries = markers.map(marker => marker.start).sort((a, b) => a - b)
    for (const marker of markers) {
      const next = boundaries.find(position => position > marker.start) ?? prompt.length
      const block = prompt.slice(marker.start, next)
      expect(`${marker.key}: ${block.toLowerCase()}`).toContain('omit this entire section when')
    }
  })
})
