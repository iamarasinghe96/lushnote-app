// The admin console's section list, kept separate from the page so it can be
// read without pulling in eleven panel components (and their Firebase imports)
// — which is what lets a unit test check the grouping at all.
//
// The page's PANELS map is typed `Record<SectionKey, ...>`, so "every section
// has a panel" is enforced by the compiler and needs no test.

export interface AdminSection {
  key: string
  label: string
  /**
   * The sections used day to day, shown as tabs in the header.
   *
   * Eleven equal tabs overflowed it into a horizontal scroll, which buried the
   * five that get opened and gave the ones that do not the same prominence.
   * The rest move under More: one click away, never hidden. Promoting a section
   * is flipping this flag, and nothing else.
   */
  pinned: boolean
}

// Roadmap is first because it is where the console opens: the shared to-do
// list the admins work from. Letterheads moved under More to make room.
export const SECTIONS = [
  { key: 'roadmap', label: 'Roadmap', pinned: true },
  { key: 'dashboard', label: 'Dashboard', pinned: true },
  { key: 'billing', label: 'Billing', pinned: true },
  { key: 'releases', label: 'Releases', pinned: true },
  { key: 'logs', label: 'Logs & Errors', pinned: true },
  { key: 'users', label: 'Users', pinned: false },
  { key: 'letterheads', label: 'Letterheads', pinned: false },
  { key: 'feedback', label: 'Feedback', pinned: false },
  { key: 'whats-new', label: "What's New", pinned: false },
  { key: 'forms', label: 'Hospital Forms', pinned: false },
  { key: 'emails', label: 'Emails', pinned: false },
  { key: 'appearance', label: 'Appearance', pinned: false },
] as const satisfies readonly AdminSection[]

export type SectionKey = (typeof SECTIONS)[number]['key']

export const PINNED = SECTIONS.filter(s => s.pinned)
export const OVERFLOW = SECTIONS.filter(s => !s.pinned)

/** Where /admin opens when the URL names no section. */
export const DEFAULT_SECTION: SectionKey = 'roadmap'

export function isSectionKey(v: string): v is SectionKey {
  return SECTIONS.some(s => s.key === v)
}
