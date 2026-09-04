import { changedLines, spliceTidiedLines, type ChangedLine } from './tidyDiff'

// Tidying a document made of several fields.
//
// A hospital form has one body. A letter does not: a referral carries a
// presenting complaint, a middle paragraph and a reason; a custom template
// carries one field per section the doctor defined. One button has to cover all
// of them, and it must still only touch what the doctor changed.
//
// Every field's changed lines go into ONE request, so a letter costs one round
// trip rather than one per field, and the reply either splices back completely
// or is discarded completely. A per-field request would half-succeed — some
// paragraphs tidied, some not, no way back to a consistent document.

export interface TidyTarget {
  /** Stable identity for the field. Only used to route replies back. */
  key: string
  value: string
  /** The text as generated or loaded; null when the doctor wrote it all. */
  baseline: string | null
  onChange: (next: string) => void
}

interface TaggedLine extends ChangedLine {
  key: string
}

export interface TidyPlan {
  /** One line per entry, in the order they will be sent. */
  lines: TaggedLine[]
  /** Exactly what goes to the model. */
  payload: string
}

export function planTidy(targets: TidyTarget[]): TidyPlan {
  const lines = targets.flatMap(t =>
    changedLines(t.baseline, t.value).map(l => ({ ...l, key: t.key })))
  return { lines, payload: lines.map(l => l.text).join('\n') }
}

export interface TidyResult {
  /** New value per target key. Only keys that actually changed appear. */
  updates: Record<string, string>
}

/**
 * Route the reply back to the fields it came from.
 *
 * Null when the model returned a different number of lines than were sent —
 * there is then no way to know which reply belongs to which field, let alone
 * which line, and a misrouted reply would move one paragraph's prose into
 * another. The caller leaves every field alone.
 */
export function applyTidy(
  targets: TidyTarget[],
  plan: TidyPlan,
  tidiedText: string,
): TidyResult | null {
  const replies = tidiedText.split('\n').map(l => l.trim()).filter(Boolean)
  if (replies.length !== plan.lines.length) return null

  const updates: Record<string, string> = {}
  for (const target of targets) {
    const mine = plan.lines
      .map((line, i) => ({ line, reply: replies[i] }))
      .filter(x => x.line.key === target.key)
    if (!mine.length) continue

    const merged = spliceTidiedLines(
      target.value,
      mine.map(x => x.line),
      mine.map(x => x.reply).join('\n'),
    )
    // spliceTidiedLines only returns null on a count mismatch, which cannot
    // happen here — the counts were just derived from each other. Guarding
    // anyway so a future change to either side fails closed rather than
    // silently dropping a field's edits.
    if (merged === null) return null
    if (merged !== target.value) updates[target.key] = merged
  }
  return { updates }
}
