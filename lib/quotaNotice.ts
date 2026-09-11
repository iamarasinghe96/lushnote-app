import type { EntitlementState } from './entitlement'

// What a doctor is told when their Gemini day runs out.
//
// The free tier is 20 requests a day against the doctor's OWN Google key, and a
// single long consultation spends ten or more of them on transcription alone
// before a note is even generated. So running out is not an edge case, it is
// what ordinary use looks like by the second or third session — which makes two
// things matter: the work must not stop (the server falls back), and the doctor
// should be told why the app just changed behaviour and what the way out is.
//
// This module owns WHEN to say it. The saying is UI; the deciding is a rule, and
// the rule is the part that would otherwise nag a paying customer.

/** localStorage key holding the date (YYYY-MM-DD) the notice was last dismissed. */
export const QUOTA_NOTICE_KEY = 'ln_quota_notice_dismissed'

/**
 * States where an upgrade is a real offer.
 *
 * `active`, `dunning` and `grace` are all doctors who have ALREADY converted —
 * offering them "Upgrade to Pro" would be selling something they bought. Only
 * someone on a trial, or on no billing record at all, has anywhere to upgrade to.
 */
const CAN_UPGRADE: ReadonlySet<EntitlementState> = new Set<EntitlementState>(['trialing', 'legacy'])

export function canUpgrade(state: EntitlementState): boolean {
  return CAN_UPGRADE.has(state)
}

/**
 * Was the notice already dismissed for the day now in progress?
 *
 * Dismissal lasts until the quota resets, not forever. Forever would silence the
 * one message that explains the degraded behaviour; every time would be nagging
 * a doctor between patients. The quota is a daily thing, so the notice is too.
 */
export function dismissedToday(stored: string | null, today: string): boolean {
  return typeof stored === 'string' && stored.trim() === today
}

export interface NoticeInput {
  /** The server reported the daily Gemini limit — not a count this app predicted. */
  limitHit: boolean
  state: EntitlementState
  dismissed: boolean
}

/**
 * Whether to show "Upgrade to Pro".
 *
 * **Driven by the server's verdict, never by the local counter.** The app's
 * `X / 20` display is a mirror of Google's count and drifts from it — a doctor
 * whose console reads 24/20 may still show 14/20 here. Announcing a limit that
 * has not actually been hit teaches doctors to ignore the notice.
 */
export function shouldShowUpgradeNotice(i: NoticeInput): boolean {
  if (!i.limitHit) return false
  if (i.dismissed) return false
  return canUpgrade(i.state)
}

/** UTC, to match the boundary Google resets the daily quota on. */
export function quotaDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
