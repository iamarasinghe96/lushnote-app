// What one AI call cost us, in money.
//
// LushNote charges a doctor a FLAT AUD $30 a month against a variable cost, so
// the only question that matters commercially is "what does this doctor cost".
// Nothing in the app could answer it: token counts were already stored per
// doctor per day, but a token count is not a number anyone can compare to $30.
//
// Deliberately PURE - no Firestore, no env, no provider SDK - for the same
// reason lib/entitlement.ts is: the API routes and the admin console must reach
// the same figure, and one function neither side can special-case is the only
// way to guarantee that.
//
// EVERY NUMBER HERE IS AN ESTIMATE. It is our arithmetic over the token counts
// a provider reported, not an invoice. It will not match Google's bill to the
// cent and must never be presented as if it does.

/** Google's own tokeniser counts, straight off the response. */
export interface TokenUsage {
  prompt: number
  output: number
  /** Billed, and in NEITHER prompt nor output. Dropping it under-reports. */
  thoughts: number
  total: number
}

/**
 * Micro-USD: one millionth of a dollar.
 *
 * Integers throughout. A cent is too coarse - a chat reply costs a fraction of
 * one - and floats accumulate visible drift once a busy month runs to tens of
 * thousands of calls, which is exactly when the figure starts mattering.
 */
export type Micros = number

interface ModelRate {
  /** micro-USD per million TEXT input tokens. */
  inPerM: number
  /** micro-USD per million output tokens. Thoughts are billed at this rate. */
  outPerM: number
  /** micro-USD per million AUDIO input tokens, where the model takes audio. */
  audioPerM?: number
}

// ── Rates ──────────────────────────────────────────────────────────────────
//
// CHECKED: not verified against the live pricing pages. This environment has no
// egress to ai.google.dev or groq.com, so these came from prior knowledge and
// are an ORDER OF MAGNITUDE, not a quote.
//
// BEFORE TRUSTING ANY FIGURE THIS PRODUCES, open both pricing pages, correct the
// table, and replace this block with the date checked. Everything downstream is
// arithmetic; only these numbers can be wrong in a way that matters.
//
//   https://ai.google.dev/gemini-api/docs/pricing
//   https://groq.com/pricing
export const PRICING: Record<string, ModelRate> = {
  // Generation, extraction, OCR and Gemini-side transcription.
  'gemini-2.5-flash':      { inPerM: 300_000, outPerM: 2_500_000, audioPerM: 1_000_000 },
  // The chat/assistant model. Cheaper, and never sees audio.
  'gemini-2.5-flash-lite': { inPerM: 100_000, outPerM: 400_000 },
  // The `chat` model key the routes actually write under.
  'chat':                  { inPerM: 100_000, outPerM: 400_000 },
  // Groq text generation.
  'llama-3.3-70b-versatile': { inPerM: 590_000, outPerM: 790_000 },
}

/** Groq whisper is billed per hour of audio, not per token. */
export const WHISPER_MICROS_PER_HOUR = 40_000

/** Groq returns one total, never a prompt/output split. Priced at the input
 *  rate: generation is overwhelmingly input (a transcript in, a note out), so
 *  the output rate would over-state it more than the input rate under-states. */
export const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile'

function rateFor(modelKey: string): ModelRate | null {
  return PRICING[modelKey] ?? null
}

/**
 * An unknown model returns null rather than 0.
 *
 * Zero is indistinguishable from "this call was free", which would let a whole
 * model quietly cost nothing after a rename. Null is a number the caller has to
 * decide what to do with, and `recordAiSpend` counts it as unpriced.
 */
export function geminiCostMicros(usage: TokenUsage, modelKey: string, audioTokens = 0): Micros | null {
  const rate = rateFor(modelKey)
  if (!rate) return null

  // Audio tokens arrive inside promptTokenCount, so they are SUBTRACTED from
  // the text input before being priced at the audio rate. Billing them twice
  // would roughly double the cost of every recorded consultation, which is the
  // single largest line here.
  const audio = Math.max(0, Math.min(audioTokens, usage.prompt))
  const text = usage.prompt - audio

  const textCost = Math.round((text * rate.inPerM) / 1_000_000)
  const audioCost = rate.audioPerM ? Math.round((audio * rate.audioPerM) / 1_000_000) : 0
  // Thoughts are billed at the output rate and appear in neither field.
  const outCost = Math.round(((usage.output + usage.thoughts) * rate.outPerM) / 1_000_000)

  return textCost + audioCost + outCost
}

export function groqTextCostMicros(totalTokens: number, modelKey: string = GROQ_DEFAULT_MODEL): Micros | null {
  const rate = rateFor(modelKey)
  if (!rate) return null
  if (totalTokens <= 0) return 0
  return Math.round((totalTokens * rate.inPerM) / 1_000_000)
}

export function whisperCostMicros(seconds: number): Micros {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round((seconds / 3600) * WHISPER_MICROS_PER_HOUR)
}

/** For the admin console. Sub-cent figures are the normal case, so two decimal
 *  places alone would render most of a month's calls as "$0.00". */
export function formatMicros(micros: Micros): string {
  if (!Number.isFinite(micros) || micros <= 0) return '$0.00'
  const dollars = micros / 1_000_000
  if (dollars < 0.01) return '<$0.01'
  if (dollars < 1) return `$${dollars.toFixed(3)}`
  return `$${dollars.toFixed(2)}`
}

/** AUD, for comparing a doctor's cost against the $30 they pay. The rate is
 *  indicative only - Stripe settles at its own rate on the day. */
export const USD_TO_AUD = 1.54

export function microsToAud(micros: Micros): number {
  return (micros / 1_000_000) * USD_TO_AUD
}

/**
 * Seconds of audio, estimated from the encoded byte count.
 *
 * Groq's whisper is billed per hour, and the transcription response we ask for
 * is `response_format: 'text'` - a bare string with no duration in it. Switching
 * to `verbose_json` would carry a real duration, but it changes the parsing on
 * the single most critical path in the app (a clinician mid-recording) to gain
 * precision on a figure already labelled an estimate. Not a trade worth making.
 *
 * Both recorders pin `audioBitsPerSecond: 48000` (hooks/useRecorder.ts,
 * hooks/useSegmentedRecorder.ts), so for anything LushNote recorded this is
 * accurate to within container overhead. An uploaded file of unknown bitrate is
 * a guess, and knowingly so.
 */
export const RECORDER_BITS_PER_SECOND = 48_000

export function audioSecondsFromBytes(bytes: number, bitsPerSecond = RECORDER_BITS_PER_SECOND): number {
  if (!Number.isFinite(bytes) || bytes <= 0 || bitsPerSecond <= 0) return 0
  return (bytes * 8) / bitsPerSecond
}
