// Deciding that a consultation has finished.
//
// Every judgement this feature makes lives here, as pure functions, because the
// consequence of getting it wrong is a recording that stops in the middle of a
// consultation. A decision that can be tested without a browser, a microphone
// or a clock is a decision that can be argued with.
//
// Nothing here logs, and nothing here is ever handed to a log: the text it
// reads is what the patient said.

export type SessionEndVerdict = 'listening' | 'possible-end'

/** Below this, the detector is not armed at all. A consultation shorter than
 *  this is a corridor conversation, and the cost of cutting one short is far
 *  higher than the convenience of ending it automatically. */
export const MIN_SESSION_MS = 5 * 60 * 1000

/** Continuous silence that must follow the closing phrase. A pause for thought
 *  is a few seconds; this is the length of a goodbye that really was one. */
export const SILENCE_MS = 20 * 1000

/** How long the doctor has to cancel. Double the fifteen seconds this was
 *  designed with, because it ships enabled: the first time a doctor meets this
 *  they are not expecting it, and the countdown is the only thing between a
 *  mis-detection and a truncated consultation. */
export const COUNTDOWN_MS = 30 * 1000

/** Only what the doctor said last matters. A goodbye in the middle of a segment
 *  is someone describing their week. */
const TAIL_WORDS = 8

/** Reported speech, not a farewell: "she said goodbye to her mother". Checked
 *  by walking back through the words rather than with a lookbehind, which
 *  crashes Safari below iOS 16.4. */
const REPORTING_VERBS = new Set([
  'said', 'says', 'say', 'saying',
  'told', 'tells', 'tell', 'telling',
  'asked', 'asks', 'ask', 'asking',
  'wrote', 'writes', 'write', 'writing',
  'replied', 'replies', 'reply',
  'mentioned', 'mentions', 'mention',
  'answered', 'answers', 'answer',
])
const REPORTING_LOOKBACK = 4

/**
 * The closings a consultation actually ends on. Each is a word sequence, and
 * each has to be strong enough that hearing it at the very end of the last
 * thing said means the appointment is over.
 *
 * Deliberately short. A longer list is a longer list of ways to stop a
 * recording early, and anything this misses simply means the doctor presses
 * Stop, which is what they do today.
 */
const CLOSING_PHRASES: readonly string[][] = [
  ['goodbye'],
  ['bye'],
  ['bye', 'for', 'now'],
  ['see', 'you'],
  ['see', 'you', 'then'],
  ['see', 'you', 'soon'],
  ['see', 'you', 'next', 'time'],
  ['take', 'care'],
  ['take', 'care', 'of', 'yourself'],
  ['look', 'after', 'yourself'],
  ['thanks', 'for', 'coming'],
  ['thank', 'you', 'for', 'coming'],
  ['thanks', 'for', 'coming', 'in'],
  ['have', 'a', 'good', 'day'],
  ['have', 'a', 'good', 'week'],
  ['have', 'a', 'good', 'weekend'],
  ['all', 'the', 'best'],
  ['thats', 'all', 'for', 'today'],
  ['well', 'leave', 'it', 'there'],
  ['lets', 'leave', 'it', 'there'],
]

/**
 * Words, lowercased, with punctuation gone and the goodbye spellings folded
 * together. Apostrophes are dropped rather than spaced, so "that's" becomes
 * "thats" and "we'll" becomes "well" - which is why the phrases above are
 * written that way.
 */
export function normaliseWords(text: string): string[] {
  const flattened = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bgood bye\b/g, 'goodbye')
    .trim()
  return flattened ? flattened.split(' ') : []
}

function endsWithPhrase(words: string[], phrase: string[], endIndex: number): boolean {
  const start = endIndex - phrase.length + 1
  if (start < 0) return false
  for (let i = 0; i < phrase.length; i++) {
    if (words[start + i] !== phrase[i]) return false
  }
  return true
}

function isReported(words: string[], phraseStart: number): boolean {
  const from = Math.max(0, phraseStart - REPORTING_LOOKBACK)
  for (let i = from; i < phraseStart; i++) {
    if (REPORTING_VERBS.has(words[i])) return true
  }
  return false
}

/**
 * Does this end on a genuine goodbye?
 *
 * The phrase has to finish inside the last few words - a closing that is not at
 * the end is not a closing - and must not be preceded by a reporting verb.
 */
export function hasClosingPhrase(text: string): boolean {
  const words = normaliseWords(text)
  if (words.length === 0) return false
  const earliestEnd = Math.max(0, words.length - TAIL_WORDS)

  for (let end = words.length - 1; end >= earliestEnd; end--) {
    for (const phrase of CLOSING_PHRASES) {
      if (!endsWithPhrase(words, phrase, end)) continue
      if (isReported(words, end - phrase.length + 1)) continue
      return true
    }
  }
  return false
}

export interface SessionEndInput {
  /** The doctor's preference. Off means this never runs. */
  enabled: boolean
  /** Only 'conversation'. Dictation is one person talking to the app, where a
   *  sign-off is part of the note rather than the end of an appointment. */
  mode: string
  sessionMs: number
  /** The newest transcribed segment, and when its recording ended. */
  segment: { text: string; at: number } | null
  /** From voice activity detection. `null` means it is not reporting, which is
   *  a reason to keep recording, never a reason to stop. */
  lastSpeechAt: number | null
  silenceMs: number
  /** A mic taken by a phone call is not a room falling quiet. */
  micLost: boolean
}

/**
 * Every condition has to hold. Any doubt at all returns 'listening', which
 * means carry on recording - the direction a mistake here must always fall.
 */
export function evaluateSessionEnd(input: SessionEndInput): SessionEndVerdict {
  if (!input.enabled) return 'listening'
  if (input.mode !== 'conversation') return 'listening'
  if (input.micLost) return 'listening'
  if (input.sessionMs < MIN_SESSION_MS) return 'listening'

  // No voice activity detection, no automatic stop. Without it there is no way
  // to know the room went quiet, and a phrase on its own must never be enough.
  if (input.lastSpeechAt === null) return 'listening'
  if (input.silenceMs < SILENCE_MS) return 'listening'

  const segment = input.segment
  if (!segment) return 'listening'

  // Someone has spoken since that segment was cut, so whatever it ended on has
  // been overtaken. This is what keeps a stale candidate from stopping a
  // conversation that carried on.
  if (input.lastSpeechAt > segment.at) return 'listening'

  return hasClosingPhrase(segment.text) ? 'possible-end' : 'listening'
}

// ── The state machine ──────────────────────────────────────────────────────

export type SessionEndState = 'LISTENING' | 'POSSIBLE_END' | 'COUNTDOWN' | 'STOPPING'

export type SessionEndEvent =
  | { type: 'CANDIDATE' }         // evaluateSessionEnd said possible-end
  | { type: 'ARM_COUNTDOWN' }     // the screen has shown it and started the clock
  | { type: 'SPEECH' }            // anyone spoke
  | { type: 'KEEP_RECORDING' }    // the doctor tapped Keep recording
  | { type: 'COUNTDOWN_ELAPSED' }
  | { type: 'STOP' }              // manual Stop, the fixed auto-stop, or Stop now

/**
 * LISTENING → POSSIBLE_END → COUNTDOWN → STOPPING, with speech or Keep
 * recording returning either middle state to LISTENING.
 *
 * STOPPING absorbs everything. That is what makes manual stop, the
 * fixed-duration auto-stop and this one safe to race: whichever arrives first
 * moves the machine, and the rest change nothing.
 */
export function sessionEndReducer(state: SessionEndState, event: SessionEndEvent): SessionEndState {
  if (state === 'STOPPING') return 'STOPPING'
  if (event.type === 'STOP') return 'STOPPING'

  switch (state) {
    case 'LISTENING':
      return event.type === 'CANDIDATE' ? 'POSSIBLE_END' : 'LISTENING'

    case 'POSSIBLE_END':
      if (event.type === 'ARM_COUNTDOWN') return 'COUNTDOWN'
      if (event.type === 'SPEECH' || event.type === 'KEEP_RECORDING') return 'LISTENING'
      return 'POSSIBLE_END'

    case 'COUNTDOWN':
      if (event.type === 'SPEECH' || event.type === 'KEEP_RECORDING') return 'LISTENING'
      if (event.type === 'COUNTDOWN_ELAPSED') return 'STOPPING'
      return 'COUNTDOWN'
  }
}
