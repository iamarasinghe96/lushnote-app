import { describe, it, expect } from 'vitest'
import {
  geminiCostMicros, groqTextCostMicros, whisperCostMicros,
  audioSecondsFromBytes, formatMicros, microsToAud,
  PRICING, RECORDER_BITS_PER_SECOND, type TokenUsage,
} from '@/lib/aiCost'

// LushNote charges a FLAT AUD $30 against a variable cost, so "what does this
// doctor cost" is the only question that decides whether the price works. Token
// counts were already stored per doctor; a token count is not a number anyone
// can compare to $30.
//
// The rates themselves are not tested - they are an input that has to be checked
// against a pricing page, and a test asserting them would only restate whatever
// was typed. What IS tested is the arithmetic around them, because every one of
// these mistakes silently under-reports rather than failing loudly:
//
//   - audio billed at the text rate, which is ~3x low on the largest line
//   - audio billed twice, because Gemini reports it inside promptTokenCount
//   - `thoughts` dropped, which is billed and sits in neither other field
//   - an unrecognised model priced at zero instead of being flagged

function usage(over: Partial<TokenUsage> = {}): TokenUsage {
  return { prompt: 0, output: 0, thoughts: 0, total: 0, ...over }
}

describe('geminiCostMicros', () => {
  it('prices text input and output at their own rates', () => {
    const rate = PRICING['gemini-2.5-flash']
    const got = geminiCostMicros(usage({ prompt: 1_000_000, output: 1_000_000 }), 'gemini-2.5-flash')
    expect(got).toBe(rate.inPerM + rate.outPerM)
  })

  // Billed, and in NEITHER prompt nor output. Dropping it under-reports every
  // 2.5 thinking call.
  it('bills thoughts at the output rate', () => {
    const rate = PRICING['gemini-2.5-flash']
    const withThoughts = geminiCostMicros(usage({ thoughts: 1_000_000 }), 'gemini-2.5-flash')
    expect(withThoughts).toBe(rate.outPerM)
  })

  // The single largest cost in the product, and the easiest to get wrong twice
  // over: audio arrives INSIDE promptTokenCount.
  it('prices audio at the audio rate, not the text rate', () => {
    const rate = PRICING['gemini-2.5-flash']
    const allAudio = geminiCostMicros(usage({ prompt: 1_000_000 }), 'gemini-2.5-flash', 1_000_000)
    expect(allAudio).toBe(rate.audioPerM)
    expect(allAudio).not.toBe(rate.inPerM)
  })

  it('does not bill audio twice by leaving it in the text input', () => {
    const rate = PRICING['gemini-2.5-flash']
    // Half the prompt was audio: half at the audio rate, half at the text rate.
    const mixed = geminiCostMicros(usage({ prompt: 1_000_000 }), 'gemini-2.5-flash', 500_000)
    expect(mixed).toBe(Math.round(rate.audioPerM! / 2) + Math.round(rate.inPerM / 2))
  })

  it('never lets audioTokens exceed the prompt it came from', () => {
    const rate = PRICING['gemini-2.5-flash']
    // A caller passing a bigger audio slice than the prompt must not produce a
    // negative text charge that cancels out real cost.
    const got = geminiCostMicros(usage({ prompt: 1_000 }), 'gemini-2.5-flash', 999_999)
    expect(got).toBe(Math.round((1_000 * rate.audioPerM!) / 1_000_000))
    expect(got).toBeGreaterThanOrEqual(0)
  })

  it('costs nothing for an empty call', () => {
    expect(geminiCostMicros(usage(), 'gemini-2.5-flash')).toBe(0)
  })

  // Zero is indistinguishable from "this was free", which is how a renamed
  // model quietly stops costing anything.
  it('returns null for a model it has no price for, never zero', () => {
    expect(geminiCostMicros(usage({ prompt: 1_000_000 }), 'gemini-9-imaginary')).toBeNull()
  })
})

describe('groqTextCostMicros', () => {
  it('prices a known model', () => {
    const rate = PRICING['llama-3.3-70b-versatile']
    expect(groqTextCostMicros(1_000_000)).toBe(rate.inPerM)
  })

  it('costs nothing for zero or negative tokens', () => {
    expect(groqTextCostMicros(0)).toBe(0)
    expect(groqTextCostMicros(-5)).toBe(0)
  })

  it('returns null for an unknown model', () => {
    expect(groqTextCostMicros(1_000, 'llama-99')).toBeNull()
  })
})

describe('whisperCostMicros', () => {
  it('bills per hour of audio', () => {
    expect(whisperCostMicros(3600)).toBe(40_000)
    expect(whisperCostMicros(1800)).toBe(20_000)
  })

  it('shrugs off junk rather than producing a negative charge', () => {
    expect(whisperCostMicros(0)).toBe(0)
    expect(whisperCostMicros(-60)).toBe(0)
    expect(whisperCostMicros(NaN)).toBe(0)
  })
})

describe('audioSecondsFromBytes', () => {
  // Both recorders pin 48 kbps, so for anything LushNote recorded this is
  // accurate to within container overhead.
  it('inverts the recorder bitrate', () => {
    const oneMinute = (RECORDER_BITS_PER_SECOND * 60) / 8
    expect(audioSecondsFromBytes(oneMinute)).toBeCloseTo(60, 6)
  })

  it('returns zero rather than Infinity on junk input', () => {
    expect(audioSecondsFromBytes(0)).toBe(0)
    expect(audioSecondsFromBytes(-1)).toBe(0)
    expect(audioSecondsFromBytes(1000, 0)).toBe(0)
  })
})

describe('accumulation', () => {
  // Integers throughout, because a month of a busy clinic is tens of thousands
  // of calls and float drift starts showing exactly when the figure matters.
  it('stays an exact integer across 10,000 calls', () => {
    let total = 0
    for (let i = 0; i < 10_000; i++) {
      total += geminiCostMicros(usage({ prompt: 1_234, output: 567, thoughts: 89 }), 'gemini-2.5-flash')!
    }
    expect(Number.isInteger(total)).toBe(true)
    expect(total).toBe(geminiCostMicros(usage({ prompt: 1_234, output: 567, thoughts: 89 }), 'gemini-2.5-flash')! * 10_000)
  })
})

describe('formatMicros', () => {
  // Most single calls cost a fraction of a cent, so two decimal places alone
  // would render a whole month of them as "$0.00".
  it('does not flatten sub-cent figures to zero', () => {
    expect(formatMicros(500)).toBe('<$0.01')
    expect(formatMicros(50_000)).toBe('$0.050')
    expect(formatMicros(2_500_000)).toBe('$2.50')
  })

  it('handles nothing and junk', () => {
    expect(formatMicros(0)).toBe('$0.00')
    expect(formatMicros(NaN)).toBe('$0.00')
  })
})

describe('microsToAud', () => {
  // The comparison that matters: a doctor pays AUD 30.
  it('converts so a cost can be read against the price', () => {
    expect(microsToAud(1_000_000)).toBeCloseTo(1.54, 6)
  })
})
