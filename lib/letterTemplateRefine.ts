// Reconciling what the doctor typed with what the refiner returned.
//
// "Refine & save" sends the doctor's topics to a model to have typos and
// dictation artifacts cleaned up. The system prompt asks it to preserve the
// exact order and number of topics and to leave [KEEP EXACTLY] ones
// character-for-character — and nothing checked that it had.
//
// So a doctor could type eight topics, a 70B model could return six (two
// merged, one dropped), and the template saved with six. Silently, under the
// doctor's own title, to be used for every letter of that type afterwards. On
// an edit, a topic they had explicitly left alone could come back reworded.
//
// This is the same lesson the ward-note pipeline already learned and wrote
// down: a fidelity requirement is enforced in code, not asked of the model.
// Refinement is cosmetic — it fixes spelling. Nothing cosmetic is worth losing
// a topic the doctor asked for, so when the shape disagrees the refinement is
// discarded whole and the doctor's own wording is saved instead.

export interface SentSection {
  heading: string
  description: string
  /** false when the doctor left this topic alone while editing an existing
   *  template — it is already how they want it and must come back untouched. */
  refine: boolean
}

export interface RefinedSection {
  heading: string
  description: string
}

/**
 * The refined topics to actually save, or `null` when the refinement cannot be
 * trusted at all.
 *
 * `null` means the model changed the NUMBER of topics. There is no safe way to
 * map six returned topics onto eight sent ones — matching by heading would
 * guess, and a wrong guess silently rewrites what a letter contains. The caller
 * falls back to saving the doctor's text as written, which is always available
 * and always correct.
 *
 * Order is positional, never by heading: the refiner is asked to fix headings,
 * so a heading is exactly the thing that may legitimately have changed and
 * therefore cannot be the key.
 */
export function reconcileRefinedSections(
  sent: SentSection[],
  returned: RefinedSection[],
): RefinedSection[] | null {
  if (!sent.length) return null
  if (returned.length !== sent.length) return null

  return sent.map((original, i) => {
    // A locked topic is restored from the doctor's own text rather than
    // trusted to have come back unchanged — the instruction to leave it alone
    // is a request, and this is the only thing that makes it a guarantee.
    if (!original.refine) {
      return { heading: original.heading, description: original.description }
    }
    const r = returned[i]
    // An emptied heading is a dropped topic wearing a different disguise, so
    // the original stands. An emptied DESCRIPTION is allowed: descriptions are
    // optional, and a doctor may have written one the refiner folded into the
    // heading.
    const heading = r.heading.trim() ? r.heading : original.heading
    return { heading, description: r.description }
  })
}

/**
 * Whether a refinement changed anything a doctor would want told about.
 *
 * Used to decide whether to say "cleaned up by AI" or stay quiet — a refiner
 * that returned the input verbatim should not claim to have done work.
 */
export function refinementChangedAnything(
  sent: SentSection[],
  reconciled: RefinedSection[],
): boolean {
  if (sent.length !== reconciled.length) return true
  return sent.some((s, i) =>
    s.heading !== reconciled[i].heading || s.description !== reconciled[i].description)
}
