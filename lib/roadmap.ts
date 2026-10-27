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

// An idea is on the list but nobody has decided to do it yet: the research
// backlog arrives as ideas, and taking one makes it a to-do.
export type RoadmapStatus = 'idea' | 'todo' | 'doing' | 'done'
export const STATUSES: readonly RoadmapStatus[] = ['idea', 'todo', 'doing', 'done']

/**
 * The categories the page groups items under, in the order shown. An item's
 * `theme` names its bucket; anything else lands in "Other" at the end, so a
 * typo or an old item is never hidden.
 */
export const BUCKETS = [
  'Platform and reliability',
  'Security and sign-in',
  'Privacy and data',
  'Privacy policy and terms',
  'Onboarding, trial and emails',
  'Capture and transcription',
  'Notes, editing and AI',
  'Templates',
  'Documents and forms',
  'Patient record',
  'Interface and experience',
  'Support',
  'Integrations',
  'Medicare, PBS and CPD',
  'Practice operations',
  'Practice billing',
  'Reporting',
  'Marketing and growth',
] as const
export const OTHER_BUCKET = 'Other'

/** docs/ROADMAP.md section code → bucket. */
export const SECTION_BUCKET: Record<string, (typeof BUCKETS)[number]> = {
  SEC: 'Security and sign-in',
  PRV: 'Privacy and data',
  LEG: 'Privacy policy and terms',
  CAP: 'Capture and transcription',
  GEN: 'Notes, editing and AI',
  TPL: 'Templates',
  DOC: 'Documents and forms',
  PAT: 'Patient record',
  OPS: 'Practice operations',
  FIN: 'Practice billing',
  MED: 'Medicare, PBS and CPD',
  RPT: 'Reporting',
  INT: 'Integrations',
  ONB: 'Onboarding, trial and emails',
  SUP: 'Support',
  UX: 'Interface and experience',
  FIX: 'Platform and reliability',
}

export function bucketOf(theme: string): string {
  return (BUCKETS as readonly string[]).includes(theme) ? theme : OTHER_BUCKET
}

/** Items grouped by bucket, buckets in BUCKETS order, empty ones left out. */
export function groupByBucket<T extends { theme: string }>(items: T[]): { bucket: string; items: T[] }[] {
  const order = [...BUCKETS, OTHER_BUCKET] as string[]
  const groups = new Map<string, T[]>()
  for (const it of items) {
    const b = bucketOf(it.theme)
    groups.set(b, [...(groups.get(b) ?? []), it])
  }
  return order.filter(b => groups.has(b)).map(b => ({ bucket: b, items: groups.get(b)! }))
}

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
  /** The docs/ROADMAP.md row this came from, e.g. "PRV-17". */
  backlogId?: string
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

/** Doing first, then to do, then ideas, then done; the agreed order within each. */
export function sortItems<T extends Pick<RoadmapItem, 'status' | 'order'>>(items: T[]): T[] {
  const rank: Record<RoadmapStatus, number> = { doing: 0, todo: 1, idea: 2, done: 3 }
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

export interface BacklogEntry {
  id: string
  section: string
  item: string
  now: string
  fit: string
  notes: string
  status: string
}

/**
 * The rows of docs/ROADMAP.md, the research backlog. Every row is
 * `| ID | Item | Now | Fit | Notes | Status |`, and no cell contains a pipe.
 */
export function parseBacklog(md: string): BacklogEntry[] {
  const out: BacklogEntry[] = []
  for (const line of md.split('\n')) {
    const m = /^\|\s*([A-Z]{2,3})-(\d+)\s*\|/.exec(line)
    if (!m) continue
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    if (cells.length !== 6) continue
    out.push({ id: cells[0], section: m[1], item: cells[1], now: cells[2], fit: cells[3], notes: cells[4], status: cells[5].toLowerCase() })
  }
  return out
}

const NOW_LABEL: Record<string, string> = { M: 'missing in LushNote', P: 'partly there', '?': 'not yet known' }
const FIT_LABEL: Record<string, string> = { Core: 'improves what doctors use today', Adj: 'needs a new concept (teams, appointments)', Area: 'a new product area' }

/**
 * The backlog rows worth bringing onto the roadmap as ideas. Rows already in
 * LushNote (Now ✓) or already decided (built, live, dropped) stay out.
 */
export function backlogIdeas(entries: BacklogEntry[]) {
  return entries
    .filter(e => e.now !== '✓' && !['built', 'live', 'dropped'].includes(e.status))
    .map((e, i) => {
      const long = e.item.length > LIMITS.title
      const title = long ? `${e.item.slice(0, LIMITS.title - 1).replace(/\s+\S*$/, '')}…` : e.item
      const notes = [
        `${e.id} in docs/ROADMAP.md. Today: ${NOW_LABEL[e.now] ?? e.now}. Fit: ${FIT_LABEL[e.fit] ?? e.fit}.`,
        long ? e.item : '',
        e.notes,
      ].filter(Boolean).join('\n\n')
      return {
        backlogId: e.id,
        title,
        notes: notes.slice(0, LIMITS.notes),
        theme: SECTION_BUCKET[e.section] ?? OTHER_BUCKET,
        // After the starter items, in the backlog's own order.
        order: 10_000 + i,
      }
    })
}
