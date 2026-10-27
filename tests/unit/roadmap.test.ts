import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  applyStepOp, progress, sortItems, clean, LIMITS, BUCKETS, SECTION_BUCKET, groupByBucket,
  parseBacklog, backlogIdeas, type RoadmapStep, type Person,
} from '@/lib/roadmap'
import { STARTER } from '@/lib/roadmapStarter'

// The shared roadmap is edited by two people at once. These pin the step
// changes the server applies inside a transaction, in particular that taking
// work never silently takes it from someone else.

const ME: Person = { uid: 'me', name: 'Me' }
const THEM: Person = { uid: 'them', name: 'Them' }
const step = (over: Partial<RoadmapStep> = {}): RoadmapStep => ({ id: 's1', text: 'Do it', done: false, owner: null, ...over })

describe('applyStepOp', () => {
  it('adds a step, trimmed', () => {
    expect(applyStepOp([], { op: 'add', text: '  Write   the test ', id: 'n' }, ME))
      .toEqual([{ id: 'n', text: 'Write the test', done: false, owner: null }])
  })

  it('refuses an empty step and a full list', () => {
    expect(applyStepOp([], { op: 'add', text: '   ', id: 'n' }, ME)).toBeNull()
    const full = Array.from({ length: LIMITS.steps }, (_, i) => step({ id: `s${i}` }))
    expect(applyStepOp(full, { op: 'add', text: 'one more', id: 'n' }, ME)).toBeNull()
  })

  it('ticks and unticks', () => {
    const once = applyStepOp([step()], { op: 'toggle', stepId: 's1' }, ME)!
    expect(once[0].done).toBe(true)
    expect(applyStepOp(once, { op: 'toggle', stepId: 's1' }, ME)![0].done).toBe(false)
  })

  it('lets you take a free step', () => {
    expect(applyStepOp([step()], { op: 'take', stepId: 's1' }, ME)![0].owner).toEqual(ME)
  })

  it('never takes a step someone else holds', () => {
    expect(applyStepOp([step({ owner: THEM })], { op: 'take', stepId: 's1' }, ME)).toBeNull()
  })

  it('releases and removes', () => {
    expect(applyStepOp([step({ owner: ME })], { op: 'release', stepId: 's1' }, ME)![0].owner).toBeNull()
    expect(applyStepOp([step(), step({ id: 's2' })], { op: 'remove', stepId: 's1' }, ME)!.map(s => s.id)).toEqual(['s2'])
  })

  it('refuses a change to a step that is gone, so a stale screen cannot act', () => {
    expect(applyStepOp([step()], { op: 'toggle', stepId: 'gone' }, ME)).toBeNull()
  })
})

describe('roadmap helpers', () => {
  it('counts progress', () => {
    expect(progress([step({ done: true }), step({ id: 's2' })])).toEqual({ done: 1, total: 2 })
  })

  it('puts work in progress first, ideas after to-dos, and done last', () => {
    const items = [
      { id: 'a', status: 'done' as const, order: 1 },
      { id: 'b', status: 'todo' as const, order: 2 },
      { id: 'c', status: 'doing' as const, order: 3 },
      { id: 'd', status: 'todo' as const, order: 1 },
      { id: 'e', status: 'idea' as const, order: 0 },
    ]
    expect(sortItems(items).map(i => i.id)).toEqual(['c', 'd', 'b', 'e', 'a'])
  })

  it('groups by bucket in the agreed order, and never hides an unknown one', () => {
    const groups = groupByBucket([
      { theme: 'Templates' }, { theme: 'Security and sign-in' }, { theme: 'Old theme' }, { theme: 'Templates' },
    ])
    expect(groups.map(g => [g.bucket, g.items.length])).toEqual([
      ['Security and sign-in', 1], ['Templates', 2], ['Other', 1],
    ])
  })

  it('caps text', () => {
    expect(clean('x'.repeat(500), LIMITS.title)).toHaveLength(LIMITS.title)
    expect(clean(42, 10)).toBe('')
  })
})

describe('starter roadmap', () => {
  it('has unique keys and puts every item in a real bucket', () => {
    expect(new Set(STARTER.map(s => s.key)).size).toBe(STARTER.length)
    for (const s of STARTER) expect(BUCKETS as readonly string[]).toContain(s.theme)
  })

  it('fits the limits the server enforces', () => {
    for (const s of STARTER) {
      expect(s.title.length).toBeLessThanOrEqual(LIMITS.title)
      expect(s.theme.length).toBeLessThanOrEqual(LIMITS.theme)
      expect(s.notes.length).toBeLessThanOrEqual(LIMITS.notes)
      expect(s.steps.length).toBeLessThanOrEqual(LIMITS.steps)
      for (const t of s.steps) expect(t.length).toBeLessThanOrEqual(LIMITS.step)
    }
  })
})

// The research backlog is imported straight from docs/ROADMAP.md, so an edit
// to that file that changes its table shape would quietly drop rows. These read
// the real file.
describe('research backlog import', () => {
  const entries = parseBacklog(readFileSync('docs/ROADMAP.md', 'utf8'))

  it('reads every row of docs/ROADMAP.md', () => {
    const rows = readFileSync('docs/ROADMAP.md', 'utf8').split('\n').filter(l => /^\|\s*[A-Z]{2,3}-\d+\s*\|/.test(l))
    expect(entries.length).toBe(rows.length)
    expect(entries.length).toBeGreaterThan(300)
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length)
  })

  it('has a bucket for every section', () => {
    for (const e of entries) expect(SECTION_BUCKET[e.section], e.id).toBeDefined()
  })

  it('brings in open ideas only, each within the limits', () => {
    const ideas = backlogIdeas(entries)
    const skipped = entries.filter(e => e.now === '✓' || ['built', 'live', 'dropped'].includes(e.status))
    expect(ideas.length).toBe(entries.length - skipped.length)
    for (const i of ideas) {
      expect(i.title.length).toBeLessThanOrEqual(LIMITS.title)
      expect(i.notes.length).toBeLessThanOrEqual(LIMITS.notes)
      expect(BUCKETS as readonly string[]).toContain(i.theme)
    }
  })

  it('keeps the full text of a long item in its notes', () => {
    const long = entries.find(e => e.item.length > LIMITS.title)!
    const idea = backlogIdeas([long])[0]
    expect(idea.title.endsWith('…')).toBe(true)
    expect(idea.notes).toContain(long.item)
  })
})
