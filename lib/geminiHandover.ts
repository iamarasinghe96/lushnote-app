// The handover from a doctor's own free Gemini key to LushNote's paid one.
//
// Two mechanisms, and they do different jobs:
//
//   1. resolveAiKeys retires the free key for the rest of the day at
//      FREE_KEY_HANDOVER_AT, a quarter of the day before Google's limit. That
//      is the handover a doctor should almost always get: planned, between
//      requests, never noticed.
//   2. This function covers the request that is in flight when the free key
//      gives out anyway - a per-minute throttle, a tally that ran behind
//      Google's, a key the doctor has since revoked. The same request is sent
//      again on the paid key, so what the doctor gets back is the note or the
//      transcribed segment they asked for, not an error.
//
// Nothing is retried beyond that one resend, and nothing is resent at all
// unless a paid key is standing behind the free one. Pure: the Firestore write
// that counts the attempt is handed in, so the ordering can be tested without a
// database.

export interface HandoverOptions {
  /** Counts one request against the free key's day. Called when - and only
   *  when - the free key is actually tried. */
  onFreeAttempt?: () => Promise<void>
  /** Scalar-only notice that the resend happened. Never the prompt, never the
   *  response, never the key. */
  onHandover?: (reason: string) => void
}

/** A short, loggable reason for why the free key did not answer. */
function reasonOf(err: unknown): string {
  const m = err instanceof Error ? err.message : ''
  return m.startsWith('GEMINI_') ? m : 'other'
}

export async function withGeminiHandover<T>(
  key: string,
  handoverKey: string | null,
  call: (key: string) => Promise<T>,
  opts: HandoverOptions = {},
): Promise<T> {
  // Everyone who is not a Pro doctor on their free allowance: one call, exactly
  // as before this existed.
  if (!handoverKey) return call(key)

  // Counted as an attempt, not a success. A throttled or revoked free key still
  // spent a try, and counting only successes would let a dead key be tried first
  // on every request for the rest of the day. Started alongside the call rather
  // than before it, and awaited before returning, so it costs no latency and is
  // committed before the response leaves.
  const counted = (opts.onFreeAttempt?.() ?? Promise.resolve()).catch(() => {})
  try {
    return await call(key)
  } catch (err) {
    opts.onHandover?.(reasonOf(err))
    return await call(handoverKey)
  } finally {
    await counted
  }
}
