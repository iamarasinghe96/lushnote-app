// The admin console's shared roadmap: a to-do list the owner and the other
// admins work through together. Each item has steps, and anyone can take an
// item or a step before starting it, so two people never quietly do the same
// thing.
//
// Lives in Firestore (`roadmap/{id}`) behind the admin API; the rules' catch-all
// deny keeps browsers out. Steps sit inside their item as one array and every
// change to them is a read-modify-write in a transaction (applyStepOp below),
// so two people ticking steps at the same moment cannot overwrite each other.
//
// docs/ROADMAP.md is the research backlog this draws from; this is the list of
// what is actually being worked on.

export type RoadmapStatus = 'todo' | 'doing' | 'done'
export const STATUSES: readonly RoadmapStatus[] = ['todo', 'doing', 'done']

export interface Person { uid: string; name: string }

export interface RoadmapStep {
  id: string
  text: string
  done: boolean
  owner: Person | null
}

export interface RoadmapItem {
  id: string
  title: string
  notes: string
  theme: string
  status: RoadmapStatus
  owner: Person | null
  order: number
  steps: RoadmapStep[]
  updatedAt: number | null
  updatedBy: string
}

export const LIMITS = { title: 160, notes: 4000, theme: 40, step: 300, steps: 60 } as const

export function clean(v: unknown, max: number): string {
  return (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Notes keep their line breaks; everything else is one line. */
export function cleanNotes(v: unknown): string {
  return (typeof v === 'string' ? v : '').replace(/\r\n/g, '\n').trim().slice(0, LIMITS.notes)
}

export function isStatus(v: unknown): v is RoadmapStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

export function progress(steps: RoadmapStep[]): { done: number; total: number } {
  return { done: steps.filter(s => s.done).length, total: steps.length }
}

/** Doing first, then to do, then done; the agreed order within each. */
export function sortItems<T extends Pick<RoadmapItem, 'status' | 'order'>>(items: T[]): T[] {
  const rank: Record<RoadmapStatus, number> = { doing: 0, todo: 1, done: 2 }
  return [...items].sort((a, b) => rank[a.status] - rank[b.status] || a.order - b.order)
}

export type StepOp =
  | { op: 'add'; text: string; id: string }
  | { op: 'toggle'; stepId: string }
  | { op: 'edit'; stepId: string; text: string }
  | { op: 'take'; stepId: string }
  | { op: 'release'; stepId: string }
  | { op: 'remove'; stepId: string }

/**
 * One change to an item's steps, applied to the steps as they are NOW (read
 * inside the transaction), never to what the browser last saw.
 *
 * Returns null when the change cannot apply: the step is gone, the text is
 * empty, or the list is full. "Take" on a step someone else holds is refused
 * rather than silently reassigned; they release it first.
 */
export function applyStepOp(steps: RoadmapStep[], op: StepOp, actor: Person): RoadmapStep[] | null {
  if (op.op === 'add') {
    const text = clean(op.text, LIMITS.step)
    if (!text || steps.length >= LIMITS.steps) return null
    return [...steps, { id: op.id, text, done: false, owner: null }]
  }
  const i = steps.findIndex(s => s.id === op.stepId)
  if (i < 0) return null
  const s = steps[i]
  let next: RoadmapStep | null = s
  switch (op.op) {
    case 'toggle': next = { ...s, done: !s.done }; break
    case 'edit': {
      const text = clean(op.text, LIMITS.step)
      if (!text) return null
      next = { ...s, text }
      break
    }
    case 'take':
      if (s.owner && s.owner.uid !== actor.uid) return null
      next = { ...s, owner: actor }
      break
    case 'release': next = { ...s, owner: null }; break
    case 'remove': next = null; break
  }
  return next ? steps.map((x, j) => (j === i ? next as RoadmapStep : x)) : steps.filter((_, j) => j !== i)
}
