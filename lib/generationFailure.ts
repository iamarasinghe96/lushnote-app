// Why a note failed to generate, whether trying again could help, and what to
// say to the doctor about it.
//
// Generation used to make ONE attempt and drop the doctor on the edit page with
// an error strip above an empty form. Most failures at this point are transient
// — a busy model, a gateway timeout on a long consultation, a garbled reply —
// and succeed immediately on a second try, so the doctor was doing by hand what
// the app could have done for them.
//
// But retrying is not free and not always sensible. A wrong API key, an
// exhausted daily quota or a lapsed subscription will fail exactly the same way
// the second time, and a doctor watching a spinner for a second pointless
// attempt is worse than being told straight away. So the retry is chosen, not
// blanket.

export type FailureKind =
  /** Try again — a second attempt has a real chance. */
  | 'transient'
  /** Trying again cannot help; say why and what to do instead. */
  | 'terminal'

export interface GenerationFailure {
  kind: FailureKind
  /** One short sentence for the doctor. No error codes, no "please". */
  message: string
  /** The next real action, if there is one. */
  action?: string
}

/**
 * Server messages that mean "the same request will fail again".
 *
 * Matched on the message rather than the status because the route flattens
 * several causes into 500, and a 429 can be either a per-minute limit (worth
 * one retry) or a daily quota (not).
 */
const TERMINAL_PATTERNS: { rx: RegExp; message: string; action?: string }[] = [
  {
    rx: /subscription|billing|payment/i,
    message: 'Note creation is paused on this account.',
    action: 'Open Billing to restore access.',
  },
  {
    rx: /suspended/i,
    message: 'This account is suspended.',
    action: 'Contact support.',
  },
  {
    rx: /per\s*day|daily limit|quota|GEMINI_DAILY_LIMIT/i,
    message: 'Today’s AI limit is used up.',
    action: 'Add a Groq key in Settings, or try tomorrow.',
  },
  {
    rx: /invalid.*key|GEMINI_KEY_INVALID|api key/i,
    message: 'Your AI key isn’t working.',
    action: 'Check it in Settings › API Keys.',
  },
  {
    rx: /invalid transcript|too short/i,
    message: 'There isn’t enough in the transcript to write a note.',
  },
]

/**
 * Classify a failed generation.
 *
 * `status` is the HTTP status when there was one. A thrown fetch (no status)
 * is treated as transient: a dropped connection mid-clinic is exactly the case
 * a retry exists for.
 */
export function classifyGenerationFailure(
  rawMessage: string | undefined,
  status?: number,
): GenerationFailure {
  const msg = (rawMessage ?? '').trim()

  for (const p of TERMINAL_PATTERNS) {
    if (p.rx.test(msg)) return { kind: 'terminal', message: p.message, action: p.action }
  }
  // 402/403 are decisions about the account, not about this request.
  if (status === 402 || status === 403) {
    return { kind: 'terminal', message: 'Note creation is paused on this account.', action: 'Open Billing to restore access.' }
  }

  if (status === 504 || status === 502) {
    return { kind: 'transient', message: 'The note took too long to generate.' }
  }
  if (status === 413) {
    // Retrying an identical oversized request cannot work, but the doctor has a
    // real move: generate from a shorter stretch of the transcript.
    return {
      kind: 'terminal',
      message: 'This session is too long for the AI to process in one go.',
      action: 'Generate from a shorter part of the transcript.',
    }
  }

  return { kind: 'transient', message: 'The AI didn’t respond.' }
}

/**
 * What the failure popup says after the retry has also failed.
 *
 * Deliberately two short lines. The doctor is mid-clinic, their recording is
 * already saved, and what they need is the reason and the way back — not a
 * paragraph explaining the architecture.
 */
export function failureDialogCopy(f: GenerationFailure): { title: string; body: string } {
  return {
    title: 'Couldn’t write the note',
    // The recording being safe is the one thing worth saying unprompted: it is
    // what the doctor is actually worried about.
    body: [f.message, f.action ?? 'Your recording is saved - try again from Patients.']
      .join(' '),
  }
}
