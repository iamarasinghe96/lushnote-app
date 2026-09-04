// Checking that a tidy-up kept the shape of the doctor's plan.
//
// Tested against the real model on 2026-09-04. It handled every fidelity trap
// put to it — an unexpanded IDC, a "?delirium" hedge, a triple negative in a
// risk line, doses, "declined" rather than "refused" — and then quietly merged
//
//   1. continue quetiapine
//     1a. cease if delirium settles
//
// into a single numbered item. Four plan steps in, three out. Nothing was lost
// in meaning, but a conditional stop order is a distinct step, and on a ruled
// hospital form that is read off paper "3 items" and "4 items" are different
// documents.
//
// The prompt already asked for the doctor's structure to be kept. It was not
// enough — which is the same lesson the letter-template refiner taught, and the
// rule the ward-note pipeline already records: a fidelity requirement is
// enforced in code, not asked of the model.

/**
 * Lines that open with a list marker: `1.`, `2)`, `1a.`, `iii.`, `-`, `•`.
 *
 * Deliberately counts sub-items as items in their own right. That is the whole
 * point — `1a.` merging into `1.` is exactly the failure being caught, and a
 * counter that treated it as part of its parent would not see it happen.
 *
 * No lookbehind: Safari below iOS 16.4 crashes on it (see CLAUDE.md).
 */
export function countListItems(text: string): number {
  return (text ?? '')
    .split('\n')
    .filter(line => /^\s*(?:\d+[a-z]?[.)]|[a-z][.)]|[ivx]+[.)]|[-•*])\s+\S/i.test(line))
    .length
}

export interface TidyCheck {
  ok: boolean
  /** Present when refused. Written for the doctor, naming what would be lost. */
  reason?: string
}

/**
 * Whether a tidied version may replace what the doctor wrote.
 *
 * Only structure is judged. Prose is what the button exists to change, so
 * comparing wording would refuse every successful rewrite — but a plan that
 * arrives with fewer steps than it left with is not a rewrite, it is an edit
 * the doctor did not ask for.
 *
 * Refusing is cheap: the draft stays exactly as typed and the doctor loses a
 * tidy-up. Accepting a silently shortened plan is not cheap at all.
 */
export function tidyPreservesStructure(before: string, after: string): TidyCheck {
  const had = countListItems(before)
  // A note with no list has no structure to lose, and prose reflowing into or
  // out of sentences is exactly what tidying does.
  if (had === 0) return { ok: true }

  const got = countListItems(after)
  if (got < had) {
    return {
      ok: false,
      reason: `Tidying would have merged your plan from ${had} items into ${got}. Your text is unchanged.`,
    }
  }
  if (got > had) {
    return {
      ok: false,
      reason: `Tidying would have split your plan from ${had} items into ${got}. Your text is unchanged.`,
    }
  }
  return { ok: true }
}
