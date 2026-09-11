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
