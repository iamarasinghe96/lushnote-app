import { beforeEach, describe, expect, it, vi } from 'vitest'
// vi.mock below is hoisted above this import, so it gets the stand-ins.
import { renameClinicianInNotes, clinicianNamesOnNotes } from '@/lib/firestore/notes'

// The paging in renameClinicianInNotes / clinicianNamesOnNotes, against an
// in-memory stand-in for Firestore. The rules side (who may run these queries
// and writes) is pinned separately in tests/rules/notes.rules.test.ts.

type Row = { id: string; userId: string; clinician: string; updatedAt: number }
let rows: Row[] = []
let commits = 0

vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => {
  type Clause =
    | { kind: 'where'; field: keyof Row; value: unknown }
    | { kind: 'limit'; n: number }
    | { kind: 'startAfter'; doc: { id: string } }
    | { kind: 'orderBy' }
  const snapOf = (list: Row[]) => ({
    size: list.length,
    empty: list.length === 0,
    docs: list.map(r => ({ id: r.id, ref: { id: r.id }, get: (f: keyof Row) => r[f] })),
  })
  return {
    collection: () => ({}),
    doc: () => ({}),
    where: (field: keyof Row, _op: string, value: unknown): Clause => ({ kind: 'where', field, value }),
    limit: (n: number): Clause => ({ kind: 'limit', n }),
    orderBy: (): Clause => ({ kind: 'orderBy' }),
    startAfter: (d: { id: string }): Clause => ({ kind: 'startAfter', doc: d }),
    query: (_c: unknown, ...clauses: Clause[]) => clauses,
    getDocsFromServer: async (clauses: Clause[]) => {
      let list = [...rows].sort((a, b) => b.updatedAt - a.updatedAt)
      for (const c of clauses) if (c.kind === 'where') list = list.filter(r => r[c.field] === c.value)
      const after = clauses.find(c => c.kind === 'startAfter') as { doc: { id: string } } | undefined
      if (after) list = list.slice(list.findIndex(r => r.id === after.doc.id) + 1)
      const lim = clauses.find(c => c.kind === 'limit') as { n: number } | undefined
      return snapOf(lim ? list.slice(0, lim.n) : list)
    },
    writeBatch: () => {
      const ops: { id: string; data: Partial<Row> }[] = []
      return {
        update: (ref: { id: string }, data: Partial<Row>) => ops.push({ id: ref.id, data }),
        commit: async () => {
          commits++
          for (const op of ops) Object.assign(rows.find(r => r.id === op.id)!, op.data)
        },
      }
    },
    getDocs: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), getDoc: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: () => 'ts',
  }
})

function seed(n: number, userId: string, clinician: string, start = 0) {
  for (let i = 0; i < n; i++) rows.push({ id: `${userId}-${clinician}-${start + i}`, userId, clinician, updatedAt: start + i })
}

beforeEach(() => { rows = []; commits = 0 })

describe('renameClinicianInNotes', () => {
  it('renames only this doctor\'s notes under the old name', async () => {
    seed(3, 'me', 'Dr Old')
    seed(2, 'me', 'Dr Colleague')
    seed(2, 'someone-else', 'Dr Old')
    expect(await renameClinicianInNotes('me', 'Dr Old', 'Dr New')).toBe(3)
    expect(rows.filter(r => r.userId === 'me' && r.clinician === 'Dr New')).toHaveLength(3)
    expect(rows.filter(r => r.clinician === 'Dr Colleague')).toHaveLength(2)
    expect(rows.filter(r => r.userId === 'someone-else' && r.clinician === 'Dr Old')).toHaveLength(2)
  })

  it('works through more notes than one query returns', async () => {
    seed(1203, 'me', 'Dr Old')
    expect(await renameClinicianInNotes('me', 'Dr Old', 'Dr New')).toBe(1203)
    expect(rows.every(r => r.clinician === 'Dr New')).toBe(true)
    expect(commits).toBe(3)
  })

  it('does nothing when the names match or one is empty', async () => {
    seed(2, 'me', 'Dr Same')
    expect(await renameClinicianInNotes('me', 'Dr Same', 'Dr Same')).toBe(0)
    expect(await renameClinicianInNotes('me', '', 'Dr New')).toBe(0)
    expect(commits).toBe(0)
  })
})

describe('clinicianNamesOnNotes', () => {
  it('counts every name across pages, most common first, ignoring blanks', async () => {
    seed(700, 'me', 'Dr Old')
    seed(4, 'me', 'Dr Colleague', 1000)
    seed(1, 'me', '', 2000)
    seed(9, 'someone-else', 'Dr Elsewhere')
    expect(await clinicianNamesOnNotes('me')).toEqual([
      { name: 'Dr Old', count: 700 },
      { name: 'Dr Colleague', count: 4 },
    ])
  })
})
