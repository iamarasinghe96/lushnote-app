// Note dates are stored for display, as DD/MM/YYYY. Compared as strings they
// sort by day of the month first, so "31/01/2026" came out newer than
// "01/02/2026" - which picked the wrong "last visit", and with it the wrong
// next session number and the wrong attendance to carry forward.

/** The date as a sortable number, or null when it is missing or not DD/MM/YYYY. */
export function noteDateValue(s: string | undefined | null): number | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(s ?? '')
  if (!m) return null
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return y * 10000 + mo * 100 + d
}

/** Newer first. A note with no readable date sorts after every dated one. */
export function compareNoteDatesDesc(a: string | undefined | null, b: string | undefined | null): number {
  const va = noteDateValue(a), vb = noteDateValue(b)
  if (va === vb) return 0
  if (va === null) return 1
  if (vb === null) return -1
  return vb - va
}

/** Whether `candidate` is a later date than `current`. An unreadable candidate never is. */
export function isLaterNoteDate(candidate: string | undefined | null, current: string | undefined | null): boolean {
  return compareNoteDatesDesc(candidate, current) < 0
}
