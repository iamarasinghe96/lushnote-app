// Find em and en dashes in text a doctor reads.
//
// They read as machine-written, which is why the rule exists. A grep cannot
// enforce it, because the rule deliberately exempts four things:
//
//   code comments      nobody reads them but us
//   AI prompt text     rewording a prompt changes what the model returns
//   log messages       same reason as comments
//   regex classes      TimePicker's [–-] must keep accepting BOTH characters,
//                      or every session time saved before the rule stops parsing
//
// So this walks the source tracking string / comment / regex state and reports
// dashes only where they would reach a screen. It is not a full parser and does
// not need to be: it needs to know whether the character it is looking at is
// inside a comment or a regex, and nothing more.

const EM = '—'
const EN = '–'

/**
 * Files whose strings are AI PROMPTS, not UI copy.
 *
 * Named individually, never a pattern. A pattern like "anything in lib/" would
 * quietly grow to cover files that do hold doctor-facing text, and the exemption
 * would stop meaning anything.
 */
export const PROMPT_FILES = new Set([
  'app/api/generate/route.ts',      // the note, letter and ward-note system prompts
  'app/api/chat/route.ts',          // transcript Q&A, assistant, support triage prompts
  'app/api/ocr/route.ts',           // the handwriting-reading prompt
  'lib/gemini.ts',                  // model instructions and JSON contracts
  'lib/personalisation.ts',         // the prefix prepended to every generation
  'lib/supportKb.ts',               // LUSHNOTE_KB, injected verbatim into a prompt
  'lib/dictationTemplate.ts',       // dictation section instructions
  'lib/letterTemplateRefine.ts',    // the refine-with-AI contract
])

/**
 * Does a `/` here start a regex rather than a division?
 *
 * DELIBERATELY CONSERVATIVE, because this runs over TSX. The textbook heuristic
 * includes `<`, `>`, `{` and `}`, and every one of those is wrong here: `</div>`
 * and `{...} />` are on nearly every line of JSX, and treating either as a regex
 * start swallows the rest of the file, desyncs the parser and reports comments
 * as UI copy. Missing a real regex only risks a false report on a dash inside
 * one, which is rare and visible; mis-detecting one corrupts everything after.
 */
function regexCanStart(prev, prev2) {
  if (prev === '') return true
  if (prev === '>' && prev2 === '=') return true   // an arrow function returning a regex
  return '(,=:!&|?'.includes(prev)
}

/**
 * An explicit, greppable opt-out, in the style of an eslint disable. Used where
 * one string in an otherwise doctor-facing file is a prompt, a Slack message or
 * a character comparison. The reason goes after the marker.
 *
 * It applies to the line it is on, to any string literal that OPENS on that
 * line, and to the line ABOVE the opener. A multi-line template cannot carry a
 * trailing comment - one would land inside the string and be sent to the model -
 * so the line above is the only place a marker can go.
 */
const OPT_OUT = 'dash-ok'

/**
 * @returns {{line: number, column: number, char: string, text: string}[]}
 */
export function scanForDashes(source, filename = '') {
  const hits = []
  let i = 0
  let line = 1
  let lineStart = 0

  // Template literals nest: `a ${ `b` } c`. Depth tracks how many ${ we are
  // inside so a } does not end the template early.
  const templateStack = []
  let state = 'code'
  let prevMeaningful = ''
  let prevMeaningful2 = ''
  let literalOptedOut = false

  const lines = source.split('\n')
  const optedOutAt = n => (lines[n - 1] ?? '').includes(OPT_OUT) || (lines[n - 2] ?? '').includes(OPT_OUT)
  const record = () => {
    const raw = lines[line - 1] ?? ''
    if (literalOptedOut || raw.includes(OPT_OUT)) return
    hits.push({
      line,
      column: i - lineStart + 1,
      char: source[i],
      text: (lines[line - 1] ?? '').trim().slice(0, 120),
    })
  }

  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]

    if (c === '\n') { line++; lineStart = i + 1; if (state === 'line-comment') state = 'code'; i++; continue }

    switch (state) {
      case 'line-comment':
        i++; continue

      case 'block-comment':
        if (c === '*' && next === '/') { state = 'code'; i += 2; continue }
        i++; continue

      case 'regex':
        // A character class can hold a dash legitimately, and so can the rest of
        // a pattern. Nothing in a regex reaches a screen.
        if (c === '\\') { i += 2; continue }
        if (c === '[') { state = 'regex-class'; i++; continue }
        if (c === '/') { state = 'code'; prevMeaningful = '/'; i++; continue }
        i++; continue

      case 'regex-class':
        if (c === '\\') { i += 2; continue }
        if (c === ']') { state = 'regex'; i++; continue }
        i++; continue

      case 'single':
      case 'double': {
        const quote = state === 'single' ? "'" : '"'
        if (c === '\\') { i += 2; continue }
        if (c === quote) { state = 'code'; literalOptedOut = false; prevMeaningful = quote; i++; continue }
        if (c === EM || c === EN) record()
        i++; continue
      }

      case 'template':
        if (c === '\\') { i += 2; continue }
        if (c === '$' && next === '{') { templateStack.push('expr'); state = 'code'; i += 2; continue }
        if (c === '`') { state = 'code'; literalOptedOut = false; prevMeaningful = '`'; i++; continue }
        if (c === EM || c === EN) record()
        i++; continue

      case 'code':
      default:
        if (c === '/' && next === '/') { state = 'line-comment'; i += 2; continue }
        if (c === '/' && next === '*') { state = 'block-comment'; i += 2; continue }
        if (c === '/' && regexCanStart(prevMeaningful, prevMeaningful2)) { state = 'regex'; i++; continue }
        if (c === "'") { state = 'single'; literalOptedOut = optedOutAt(line); i++; continue }
        if (c === '"') { state = 'double'; literalOptedOut = optedOutAt(line); i++; continue }
        if (c === '`') { state = 'template'; literalOptedOut = optedOutAt(line); i++; continue }
        if (c === '}' && templateStack.length) { templateStack.pop(); state = 'template'; i++; continue }
        // Bare JSX text lives in code state, and it reaches the screen.
        if (c === EM || c === EN) record()
        if (!/\s/.test(c)) { prevMeaningful2 = prevMeaningful; prevMeaningful = c }
        i++; continue
    }
  }

  return filename && PROMPT_FILES.has(filename) ? [] : hits
}
