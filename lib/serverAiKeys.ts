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

/**
 * Fair-use ceiling, in micro-USD per month.
 *
 * SHIPS DISABLED (0 = no ceiling). A number guessed before any real data would
 * either never fire or fire on a doctor doing ordinary work. Turn it on once
 * users/{uid}.aiCost has a month of figures behind it, and pick it from the
 * distribution rather than from an estimate.
 *
 * For scale when the time comes: AUD $30 is roughly USD $19.50, less Stripe
 * fees, so about 18_700_000 micro-USD of revenue per doctor per month.
 */
export const PRO_MONTHLY_CEILING_MICROS = 0

export interface AiKeyChoice {
  geminiKey: string | null
  groqKey: string | null
  /** True when LushNote's keys are serving this request, i.e. we are paying. */
  pro: boolean
  /** True when a Pro doctor is over the ceiling and has been handed back to
   *  their own keys. The response carries this so the page can say so. */
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
  monthSpendMicros: number
  userGeminiKey: string | null
  userGroqKey: string | null
  proGeminiKey: string | null
  sharedGroqKey: string | null
  /** Defaults to PRO_MONTHLY_CEILING_MICROS. Injectable so the degrade path is
   *  exercised by tests while the real ceiling is still 0 - otherwise turning it
   *  on would be the first time that branch had ever run. */
  ceilingMicros?: number
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
    groqKey: own.groq ?? sharedGroq,
    pro: false,
    degraded,
    sharedGroq: !own.groq && !!sharedGroq,
  })

  if (!isProState(input.state)) return asFree(false)

  // Over the ceiling: hand back to their own keys and say so. Never blocked -
  // the same rule the rest of the app is built on.
  const ceiling = input.ceilingMicros ?? PRO_MONTHLY_CEILING_MICROS
  if (ceiling > 0 && input.monthSpendMicros >= ceiling) {
    return asFree(true)
  }

  // A Pro key that is missing or blank is a configuration fault, not a reason to
  // fail a doctor. Falling back to their own key makes Pro silently become the
  // old behaviour, which the admin health card is there to surface.
  if (!proGemini && !sharedGroq) return asFree(false)

  return {
    geminiKey: proGemini ?? own.gemini,
    groqKey: sharedGroq ?? own.groq,
    pro: true,
    degraded: false,
    sharedGroq: !!sharedGroq,
  }
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
