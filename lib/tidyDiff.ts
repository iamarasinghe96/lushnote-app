// Tidying only what the doctor changed.
//
// A generated progress note is already formal prose written by a model. When a
// doctor opens one, adds two rough lines and presses AI tidy, rewriting the
// WHOLE note re-renders work that was already correct — headings move, plan
// wording shifts, and a note the doctor had accepted comes back different in
// places they never touched. They pressed the button to clean up what they just
// wrote, not to regenerate the document.
//
// So tidy operates on the lines that differ from the baseline — the text as it
// stood when it was generated, loaded, or last tidied — and every other line is
// passed through byte-identical.
//
// The alternative, sending everything and asking the model to leave the rest
// alone, is the same mistake the letter-template refiner made: a fidelity
// requirement asked of a model rather than enforced. Lines it is never shown
// cannot be changed.

export interface ChangedLine {
  /** Position in the current text, so the reply can be spliced back exactly. */
  index: number
  text: string
}

/**
 * Lines present in `current` that are not in `baseline` at the same position.
 *
 * Deliberately positional and dumb rather than a real diff. A proper LCS would
 * track a line that MOVED and call it unchanged — but a moved line still has to
 * land back where the doctor put it, and the cost of being wrong here is only
 * that an already-formal line gets tidied again, which is harmless. Splicing a
 * line back to the wrong index would not be harmless, and that is what a
 * cleverer match risks.
 *
 * With no baseline every non-empty line is "changed", so a note the doctor
 * typed from scratch tidies whole — which is the right behaviour for it.
 */
export function changedLines(baseline: string | null, current: string): ChangedLine[] {
  const base = (baseline ?? '').split('\n')
  return current.split('\n')
    .map((text, index) => ({ index, text }))
    // Blank lines and lines that are only formatting carry no grammar to fix,
    // and sending them wastes a round trip and invites the model to "improve"
    // the spacing.
    .filter(l => l.text.trim().length > 0)
    .filter(l => base[l.index] !== l.text)
}

/**
 * Put tidied lines back where they came from.
 *
 * Returns null when the model did not return one line per line sent. That is
 * unrecoverable — there is no way to know which reply belongs to which line,
 * and guessing would place a tidied sentence on the wrong plan step. The caller
 * leaves the doctor's text alone.
 */
export function spliceTidiedLines(
  current: string,
  changed: ChangedLine[],
  tidiedText: string,
): string | null {
  if (!changed.length) return current

  const replies = tidiedText.split('\n').map(l => l.trim()).filter(Boolean)
  if (replies.length !== changed.length) return null

  const lines = current.split('\n')
  changed.forEach((line, i) => {
    // An empty reply means the model dropped the line rather than tidying it,
    // so the doctor's own words stand.
    lines[line.index] = replies[i] || line.text
  })
  return lines.join('\n')
}

/**
 * The house formatting rules, restated for a line-by-line rewrite.
 *
 * The note in front of the doctor already uses them — `**Plan**` on its own
 * line, numbered steps beneath — because /api/generate asked for them. A tidy
 * pass that flattened a bold heading or turned a plan into prose would undo
 * formatting the rest of the app depends on for the preview and the PDF.
 */
export const TIDY_FORMAT_RULES = [
  'Return EXACTLY one output line for each input line, in the same order. Never merge two lines into one, never split one line into two, and never add or remove a line.',
  'Keep each line\'s existing formatting: a heading wrapped in ** stays a heading wrapped in **, a numbered or lettered item keeps its exact marker and indentation, a bullet stays a bullet.',
  'Never output a markdown table (no "|" columns).',
  'If a line is already correct, return it unchanged.',
].join(' ')
