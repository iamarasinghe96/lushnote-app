// Which recovery drafts to keep, and which to let go.
//
// There used to be exactly one — `transcriptDrafts/current` — so recording a
// second patient before the first became a note overwrote the first, silently.
// A doctor who recorded, was called away, came back and recorded someone else
// lost the earlier consultation with no warning. Worse, the write MERGED, so a
// half-finished handoff survived onto the new transcript: patient B's session
// carrying patient A's name, reg number and date of birth.
//
// One document per recording session fixes both. The cost is that abandoned
// drafts now accumulate, and a draft is a full patient transcript — so they
// have to expire.

/**
 * A draft is only useful until it becomes a note. A week is far longer than any
 * realistic gap between recording a consultation and writing it up, and short
 * enough that an abandoned transcript does not sit in the database for months.
 */
export const DRAFT_TTL_DAYS = 7

/**
 * A hard ceiling regardless of age. A doctor with fifty unfinished recordings
 * has a workflow problem the app cannot solve, and the Patients list would be
 * unusable. The newest are kept, since those are the ones still being chased.
 */
export const MAX_LIVE_DRAFTS = 12

export interface DraftLike {
  id: string
  /** Milliseconds. Drafts written before this field existed have none. */
  updatedAtMs?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Split drafts into the ones to show and the ones to delete.
 *
 * Input order does not matter: sorting happens here so a caller cannot get the
 * "newest" wrong. A draft with no timestamp is treated as OLD rather than new —
 * it predates the field, so it is from an earlier build, and a stale transcript
 * shown as the newest recording is how a doctor opens the wrong session.
 */
export function partitionDrafts<T extends DraftLike>(
  drafts: T[],
  now: number = Date.now(),
): { live: T[]; expired: T[] } {
  const cutoff = now - DRAFT_TTL_DAYS * DAY_MS
  const sorted = [...drafts].sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))

  const live: T[] = []
  const expired: T[] = []
  for (const d of sorted) {
    const tooOld = (d.updatedAtMs ?? 0) < cutoff
    if (tooOld || live.length >= MAX_LIVE_DRAFTS) expired.push(d)
    else live.push(d)
  }
  return { live, expired }
}

/**
 * When this draft should stop existing, as a Timestamp-able instant.
 *
 * Written on every save so the value tracks the LAST activity, not the first:
 * a recording still being added to is not abandoned. Firestore's TTL policy
 * needs a future instant on a real Timestamp — a millisecond number is ignored
 * by the policy, which is a trap this repo has already hit once with
 * `stripe_events`.
 */
export function draftExpiryDate(now: number = Date.now()): Date {
  return new Date(now + DRAFT_TTL_DAYS * DAY_MS)
}
