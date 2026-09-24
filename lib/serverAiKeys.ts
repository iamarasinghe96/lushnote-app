// Which Groq key serves a request, and whether it is ours.
//
// A doctor's Gemini free tier is 20 requests a day and a long consultation
// spends most of them transcribing. Before this, a doctor who had not pasted a
// Groq key of their own lost transcription mid-recording and got no note at the
// end — the audio survived (the recorder uploads it before transcribing), but
// the session was unusable until the next day.
//
// `LUSHNOTE_GROQ_KEY` already existed for support chat. Using it here is what
// makes running out of Gemini a change in provider rather than a stop in work.

export interface GroqKeyChoice {
  key: string | null
  /** True when this is LushNote's key rather than the doctor's own. Callers log
   *  it, because a bill lands on us and the reason should be visible. */
  shared: boolean
}

/**
 * The doctor's own key first, always.
 *
 * Theirs has their own limits and costs us nothing; ours is the safety net that
 * keeps a clinic running when theirs is spent. Preferring ours would spend
 * LushNote's rate limit on doctors who did not need it and would exhaust the
 * shared key that everyone else depends on.
 */
export function resolveGroqKey(userKey: string | null | undefined): GroqKeyChoice {
  const own = (userKey ?? '').trim()
  if (own) return { key: own, shared: false }

  const shared = (process.env.LUSHNOTE_GROQ_KEY ?? '').trim()
  if (shared) return { key: shared, shared: true }

  return { key: null, shared: false }
}

// ── Pro: LushNote's own paid keys, for doctors who pay ─────────────────────

import { isProState, type EntitlementState } from '@/lib/entitlement'
import { GEMINI_RPD } from '@/lib/gemini'
import { FAIR_USE_ALLOWANCE_MICROS } from '@/lib/fairUse'

/**
 * The usage tally that counts requests a Pro doctor's OWN free key has been
 * asked to serve today. Kept apart from the per-model tallies because those
 * count every Gemini request whichever key answered, and the handover needs
 * to know about this key alone.
 */
export const FREE_KEY_TALLY = 'free-key'

/**
 * A Pro doctor's own free Gemini key serves their requests until this many
 * have been sent to it today, then LushNote's paid key takes over for the rest
 * of the day.
 *
 * Three quarters of the free allowance, not all of it. Our tally is not
 * Google's: one of our requests can be several of theirs (the overload backoff
 * and the model fallback in geminiPost each send another), and requests racing
 * each other can both read the same count. Handing over with a quarter of the
 * day still in hand means the free key is retired while it is still working,
 * rather than discovered empty in the middle of a consultation.
 */
export const FREE_KEY_HANDOVER_AT = Math.floor(GEMINI_RPD * 0.75)

export interface AiKeyChoice {
  geminiKey: string | null
  /**
   * LushNote's paid key, set only while a Pro doctor's own free key is serving
   * `geminiKey`. If that free key fails partway through a request - quota,
   * throttle, a revoked key - the SAME request is re-sent on this one, so the
   * handover never costs a doctor a note or a transcribed segment.
   * See withGeminiHandover.
   */
  geminiHandoverKey: string | null
  /**
   * LushNote's Gemini key whenever it is in play for this request - as the key
   * itself or as the handover behind the doctor's own. Call sites compare the
   * key that actually answered against it (see onLushnoteKey) so the cost is
   * recorded against whoever really paid. Fair use is measured on that split.
   */
  lushnoteGeminiKey: string | null
  groqKey: string | null
  /** True when LushNote's keys back this request, i.e. we pay for whatever the
   *  doctor's own free key does not cover - either directly, or as the
   *  handover key behind it. */
  pro: boolean
  /** True when a Pro doctor has used this month's fair-use allowance and has
   *  been handed back to their own keys until the month turns. */
  degraded: boolean
  /** Present only when the Groq key in use is LushNote's shared one. */
  sharedGroq: boolean
}

/**
 * Which keys serve this request.
 *
 * PURE - no env reads beyond the two server keys, no Firestore, no Stripe - for
 * the same reason resolveEntitlement is: this decides who pays for a call, and
 * the routes and any future admin view must not be able to disagree about it.
 *
 * Never returns an empty pair when any key exists anywhere. A doctor is never
 * blocked by this function; the worst outcome is that they are served by the
 * same keys they would have used before Pro existed.
 */
export function resolveAiKeys(input: {
  state: EntitlementState
  /** This month's spend on LUSHNOTE'S keys only (paidSpend of the month's
   *  aiCost record). Calls the doctor's own key served cost us nothing and do
   *  not count towards fair use. */
  paidSpendMicros: number
  /** Enterprise: the organisation's own key pays for the AI, so ours is never
   *  put behind it and no allowance applies. */
  enterprise: boolean
  userGeminiKey: string | null
  userGroqKey: string | null
  proGeminiKey: string | null
  sharedGroqKey: string | null
  /** Requests the doctor's own free key has been sent today, from the
   *  FREE_KEY_TALLY usage record. Only read for a Pro doctor. */
  freeKeyUsedToday: number
  /** Defaults to FAIR_USE_ALLOWANCE_MICROS. Injectable so tests can put an
   *  account either side of the line without spending eighteen dollars. */
  allowanceMicros?: number
}): AiKeyChoice {
  const own = {
    gemini: (input.userGeminiKey ?? '').trim() || null,
    groq: (input.userGroqKey ?? '').trim() || null,
  }
  const proGemini = (input.proGeminiKey ?? '').trim() || null
  const sharedGroq = (input.sharedGroqKey ?? '').trim() || null

  // Exactly today's behaviour for everyone who is not Pro: the doctor's own key
  // first, the shared Groq key as the net that keeps a clinic running.
  const asFree = (degraded: boolean): AiKeyChoice => ({
    geminiKey: own.gemini,
    geminiHandoverKey: null,
    lushnoteGeminiKey: null,
    groqKey: own.groq ?? sharedGroq,
    pro: false,
    degraded,
    sharedGroq: !own.groq && !!sharedGroq,
  })

  if (!isProState(input.state)) return asFree(false)

  // Enterprise: the organisation's key pays, which is the whole agreement. Ours
  // is not put behind it even as a handover - that would quietly move their AI
  // bill back onto us. The shared Groq net stays, as it does for everyone.
  if (input.enterprise) return asFree(false)

  // Fair use used up: back to their own keys until the month turns, and the
  // page says so. Never blocked - the same rule the rest of the app is built on.
  const allowance = input.allowanceMicros ?? FAIR_USE_ALLOWANCE_MICROS
  if (allowance > 0 && input.paidSpendMicros >= allowance) {
    return asFree(true)
  }

  // A Pro key that is missing or blank is a configuration fault, not a reason to
  // fail a doctor. Falling back to their own key makes Pro silently become the
  // old behaviour, which the admin health card is there to surface.
  if (!proGemini && !sharedGroq) return asFree(false)

  // The doctor's own free key first, while it has most of its day left. It
  // costs LushNote nothing, and the paid key sits behind it on every request so
  // a free key that gives out mid-request hands over rather than failing.
  // Retired for the rest of the day at FREE_KEY_HANDOVER_AT, before Google's
  // limit, never at it. A doctor with no key of their own goes straight to the
  // paid one, as before.
  const freeFirst = !!own.gemini && !!proGemini && input.freeKeyUsedToday < FREE_KEY_HANDOVER_AT

  return {
    geminiKey: freeFirst ? own.gemini : (proGemini ?? own.gemini),
    geminiHandoverKey: freeFirst ? proGemini : null,
    lushnoteGeminiKey: proGemini,
    groqKey: sharedGroq ?? own.groq,
    pro: true,
    degraded: false,
    sharedGroq: !!sharedGroq,
  }
}

/** Whether the key that answered a Gemini call was LushNote's. */
export function onLushnoteKey(keys: Pick<AiKeyChoice, 'lushnoteGeminiKey'>, servedKey: string | null | undefined): boolean {
  return !!servedKey && servedKey === keys.lushnoteGeminiKey
}

/** Server-only. NEVER prefix with NEXT_PUBLIC_: that inlines a value into the
 *  browser bundle, which would publish our paid key to every visitor.
 *
 *  Deliberately NOT the existing GEMINI_API_KEY, which is a free-tier shared key
 *  gated by the 20-a-day checkQuota. Pro must not be quota-gated, so it cannot
 *  reuse that variable. */
export function proGeminiKey(): string | null {
  return (process.env.LUSHNOTE_GEMINI_PRO_KEY ?? '').trim() || null
}

export function sharedGroqKey(): string | null {
  return (process.env.LUSHNOTE_GROQ_KEY ?? '').trim() || null
}
