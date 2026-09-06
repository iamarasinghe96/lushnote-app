// Finding an AI-quoted fragment inside the raw transcript.
//
// "Tap to find in transcript" used `text.indexOf(quote)`, then `indexOf` of the
// first five words, then gave up silently. Both are case-sensitive and
// whitespace-exact, and the model does neither:
//
//   transcript  "…and how did that exam period go for you in the end?"
//   quote       "How did that exam period go for you in the end?"
//
// It capitalises a fragment lifted from mid-sentence, so the match failed and
// nothing happened — no highlight, no error, no clue. It looked like a
// desktop-only fault purely because the quote that happened to be tested on a
// phone began at a sentence boundary.
//
// Newlines are the same trap: the transcript renders `whitespace-pre-wrap`, so
// its textContent keeps the line breaks the model replaced with spaces.
//
// So matching is done on a normalised copy, and the offsets are mapped back to
// the ORIGINAL string — the caller builds a DOM Range from them, and a Range
// built against normalised indices would highlight the wrong words.

export interface QuoteMatch {
  /** Offsets into the ORIGINAL haystack. */
  start: number
  end: number
}

interface Normalised {
  text: string
  /** For each character in `text`, its index in the original. */
  map: number[]
}

/**
 * Lowercase, collapse every run of whitespace to one space, and fold the
 * punctuation a model swaps without meaning to: curly quotes for straight,
 * en/em dashes for hyphens.
 *
 * Nothing is dropped outright — every kept character keeps a pointer home, so
 * the match can always be expressed as a range over the original.
 */
function normalise(input: string): Normalised {
  const out: string[] = []
  const map: number[] = []
  let pendingSpace = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      // Collapse the run; the space is only emitted once something follows it,
      // so leading and trailing whitespace never enter the normalised form.
      pendingSpace = out.length > 0
      continue
    }
    if (pendingSpace) {
      out.push(' ')
      map.push(i)
      pendingSpace = false
    }
    let c = ch.toLowerCase()
    if (c === '‘' || c === '’' || c === 'ʼ') c = "'"
    else if (c === '“' || c === '”') c = '"'
    else if (c === '–' || c === '—') c = '-'
    out.push(c)
    map.push(i)
  }
  return { text: out.join(''), map }
}

function locate(hay: Normalised, needle: string): QuoteMatch | null {
  const n = normalise(needle).text
  if (!n) return null
  const at = hay.text.indexOf(n)
  if (at === -1) return null
  return {
    start: hay.map[at],
    // +1 because map holds the index of the character itself, and a Range end
    // is exclusive — off by one here drops the final letter of the quote.
    end: hay.map[at + n.length - 1] + 1,
  }
}

/** How many leading words to fall back to when the whole quote is not present.
 *  The model sometimes trims or paraphrases the tail of a long quote; the
 *  opening words are what it actually lifted. */
const FALLBACK_WORDS = 5

/**
 * Where `quote` sits inside `haystack`, or null.
 *
 * Tries the whole quote first, then its opening words. Returning null is a real
 * answer — the caller should say so rather than doing nothing, which is what
 * made this look like a broken button.
 */
export function findQuoteRange(haystack: string, quote: string): QuoteMatch | null {
  if (!haystack || !quote?.trim()) return null
  const hay = normalise(haystack)

  const whole = locate(hay, quote)
  if (whole) return whole

  const words = quote.trim().split(/\s+/)
  if (words.length <= FALLBACK_WORDS) return null
  return locate(hay, words.slice(0, FALLBACK_WORDS).join(' '))
}
