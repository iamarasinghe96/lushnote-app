import type { Workplace } from '@/types'

// Does this registration number match the hospital's own format?
//
// Lived as a private function inside the edit page, which is why the
// confirm-transcript window - the screen where most numbers are actually typed -
// never checked anything at all. One copy, reachable from both.

export type RegStatus = 'valid' | 'invalid' | 'none'

/**
 * `none` means "no opinion", and it covers three different innocent cases: a
 * field nobody has filled in yet, a workplace that does not use registration
 * numbers, and a stored pattern we cannot compile. The last one is OUR problem -
 * `regPattern` is generated from what a doctor typed during onboarding - and
 * must never be shown to them as their mistake.
 */
export function checkRegStatus(value: string, workplace: Workplace | undefined): RegStatus {
  if (!workplace || workplace.regSystem !== 'existing' || !workplace.regPattern) return 'none'
  if (!value) return 'none'
  try {
    return new RegExp(workplace.regPattern).test(value) ? 'valid' : 'invalid'
  } catch {
    return 'none'
  }
}
