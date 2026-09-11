import type { EntitlementState } from './entitlement'

// What a doctor is told when their Gemini day runs out.
//
// The free tier is 20 requests a day against the doctor's OWN Google key, and a
// single long consultation spends ten or more of them on transcription alone
// before a note is even generated. So running out is not an edge case, it is
// what ordinary use looks like by the second or third session of a normal day.
//
// The server already makes sure nothing stops — LushNote's own Groq key carries
// the work. This module owns the only remaining question: whether to MENTION it.
//
// The answer is "twice, ever". A doctor on a three-month trial will hit the
// limit dozens of times; telling them every time is nagging somebody between
// patients about something that is not stopping them. Twice, a fortnight apart,
// is enough for the offer to have been made.

/** Twice in the whole trial. Not twice a month, not twice a week — twice. */
export const MAX_UPGRADE_NOTICES = 2

/** And the second one no sooner than a fortnight after the first, so the two do
 *  not land in the same week of a doctor getting used to the app. */
export const UPGRADE_NOTICE_GAP_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * States where an upgrade is a real offer.
 *
 * `active`, `dunning` and `grace` are doctors who have ALREADY converted —
 * offering them "Upgrade" would be selling something they bought. `paywalled`
 * is already being asked for payment by the paywall itself, and a second upsell
 * on top of it is noise at the worst moment.
 */
const CAN_UPGRADE: ReadonlySet<EntitlementState> = new Set<EntitlementState>(['trialing', 'legacy'])

export function canUpgrade(state: EntitlementState): boolean {
  return CAN_UPGRADE.has(state)
}

/**
 * Firestore hands back whatever is stored, which after a bad write or a hand
 * edit may not be numbers at all. A junk entry that survived would either block
 * the notice forever or let it through every time, and both failures are silent.
 */
export function readShownAt(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
}

export interface NoticeInput {
  /** The server reported the daily Gemini limit — not a count this app predicted. */
  limitHit: boolean
  state: EntitlementState
  /** When this doctor has been shown the notice before, oldest first. */
  shownAt: readonly number[]
  now: number
}

/**
 * Whether to show the upgrade notice.
 *
 * **Driven by the server's verdict, never by the local counter.** The app's
 * `X / 20` display mirrors Google's count and drifts from it — a doctor whose
 * console reads 24/20 may still show 14/20 here. Announcing a limit that has
 * not actually been hit teaches doctors to ignore the notice.
 */
export function shouldShowUpgradeNotice(i: NoticeInput): boolean {
  if (!i.limitHit) return false
  if (!canUpgrade(i.state)) return false

  const shown = readShownAt(i.shownAt)
  if (shown.length >= MAX_UPGRADE_NOTICES) return false
  if (shown.length === 0) return true

  const last = shown[shown.length - 1]
  return i.now - last >= UPGRADE_NOTICE_GAP_DAYS * DAY_MS
}

/**
 * The list to store after showing it.
 *
 * Counted when it is SHOWN, not when it is dismissed. A doctor who sees it and
 * navigates away has still been told, and treating that as "not yet shown"
 * would bring it back tomorrow — which is the nagging this exists to prevent.
 */
export function recordNoticeShown(shownAt: readonly number[], now: number): number[] {
  return [...readShownAt(shownAt), now].slice(-MAX_UPGRADE_NOTICES)
}
