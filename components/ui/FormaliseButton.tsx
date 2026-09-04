'use client'

import { useState } from 'react'
import { getGroqKey } from '@/lib/utils'
import { tidyPreservesStructure } from '@/lib/tidyGuard'
import { TIDY_FORMAT_RULES } from '@/lib/tidyDiff'
import { planTidy, applyTidy, type TidyTarget } from '@/lib/tidyTargets'

// Tidy up the wording of something the doctor typed themselves.
//
// This is the ONLY AI in the Create Document pathway, and it is deliberately
// the smallest kind: it rewrites the doctor's own draft into formal prose. It
// does not compose, summarise or infer — `/api/chat` type:'standardize' is
// instructed to maintain every clinical fact and add nothing not present.
//
// It replaces clinical text a doctor wrote, so it is undoable. A rewrite that
// dropped a qualifier would otherwise be unrecoverable, and "check it carefully"
// is not a safeguard — it is a request to do the proofreading the button was
// pressed to avoid.
//
// It also only touches what CHANGED. A generated note is already formal prose;
// rewriting it whole re-renders work that was correct and hands the doctor back
// a document they had accepted, altered in places they never touched. See
// lib/tidyDiff.

interface FormaliseButtonProps {
  /**
   * The fields making up this document. A hospital form has one; a referral
   * letter has three; a custom template has one per section the doctor defined.
   *
   * Each carries its own baseline — the text as generated or loaded. Lines
   * matching it are never sent, so the model cannot change them. A target with
   * a null baseline was written entirely by the doctor and tidies whole.
   */
  targets: TidyTarget[]
  /** What kind of document this is, so the rewrite matches its register. */
  documentLabel: string
  uid?: string
  className?: string
}

const PILL = 'shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full motion-safe:active:scale-95 motion-safe:transition-transform disabled:opacity-50 disabled:cursor-not-allowed'

// The one control on this bar that calls a model, so it is the one control that
// does not look like the bar. Blue → teal → green, which is the app's own
// palette (--blue-dk, the workspace teal, the workspace green) rather than a
// new set of colours, and reads as distinctly "AI" against the green glass.
//
// Every stop is dark enough to carry white text: the green end is #0e9f6e, not
// the brand's brighter #10b981, because white on the latter is about 2.5:1 and
// this text is 12px. A pretty button nobody can read is a worse button.
const AI_GRADIENT: React.CSSProperties = {
  backgroundImage: 'linear-gradient(135deg, #1d4ed8 0%, #0e7490 58%, #0e9f6e 100%)',
  // A hairline of white lifts it off the green bar without a hard edge, and a
  // low shadow keeps it sitting on the bar rather than floating over it.
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.35), 0 1px 4px rgba(15,23,42,0.18)',
}

export default function FormaliseButton({
  targets, documentLabel, uid, className = '',
}: FormaliseButtonProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Every field's value before the last tidy, so Undo restores the whole
  // document at once. A per-field undo would let a doctor put half of it back.
  const [previous, setPrevious] = useState<Record<string, string> | null>(null)
  // After a successful tidy the result becomes that field's baseline: pressing
  // again should find nothing to do until the doctor writes something new,
  // rather than re-tidying prose this button just produced.
  const [tidied, setTidied] = useState<Record<string, string>>({})

  const effective: TidyTarget[] = targets.map(t => ({
    ...t,
    baseline: tidied[t.key] ?? t.baseline,
  }))

  async function formalise() {
    if (working) return
    // Only what the doctor changed since this text was generated, loaded, or
    // last tidied. A generated note is already formal prose; rewriting it whole
    // re-renders work that was correct and hands back a document the doctor had
    // already accepted, altered in places they never touched.
    const plan = planTidy(effective)
    if (!plan.lines.length) {
      setError('Nothing new to tidy.')
      return
    }
    setWorking(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const groqKey = getGroqKey()
      if (groqKey) headers['x-groq-key'] = groqKey
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'standardize',
          // Only the changed lines are sent. Lines the model is never shown
          // cannot be altered by it — the guarantee is structural rather than
          // a request, which is the lesson the letter-template refiner taught.
          rawInput: plan.payload,
          prompt: [
            `These are lines from a ${documentLabel} written by the treating doctor.`,
            'Correct grammar, spelling and dictation artefacts, and render each as formal clinical prose.',
            TIDY_FORMAT_RULES,
            // Each rule below is a failure observed against the real model on
            // 2026-09-04, not a precaution. The one-line-per-line rule is ALSO
            // enforced in code (applyTidy) because asking was not enough.
            'Do not strengthen uncertainty: "maybe", "?", "query" and "possible" must stay as hedges, and an approximate figure must not become a precise or averaged one.',
            'Do not substitute a near-synonym for a clinical word — "settles" is not "resolves", "declined" is not "refused".',
            'Expand an abbreviation only to its literal meaning, adding no detail the doctor did not write.',
            'Do not add, infer or remove any clinical detail.',
          ].join(' '),
          uid,
        }),
      })
      const data = await res.json() as { result?: string; error?: string }
      const result = (data.result ?? '').trim()
      // An empty or errored reply must leave the doctor's text alone. Replacing
      // it with nothing would destroy the draft to report a failure.
      if (!result || result.startsWith('Error:')) {
        setError(data.error ?? 'Could not tidy the wording. Your text is unchanged.')
        return
      }
      // One reply per line sent, or nothing at all. A mismatch means there is no
      // way to know which reply belongs to which line — and across fields, a
      // misrouted reply would move one paragraph's prose into another.
      const applied = applyTidy(effective, plan, result)
      if (!applied) {
        setError('Tidying returned a different number of lines. Your text is unchanged.')
        return
      }
      // Structure is checked per field BEFORE anything is written, so a merged
      // plan in one paragraph cannot leave the rest of the letter half-tidied.
      for (const t of effective) {
        const next = applied.updates[t.key]
        if (next === undefined) continue
        const check = tidyPreservesStructure(t.value, next)
        if (!check.ok) { setError(check.reason!); return }
      }
      const before: Record<string, string> = {}
      for (const t of effective) {
        const next = applied.updates[t.key]
        if (next === undefined) continue
        before[t.key] = t.value
        t.onChange(next)
      }
      if (!Object.keys(before).length) {
        setError('Nothing needed changing.')
        return
      }
      setPrevious(before)
      setTidied(prev => ({ ...prev, ...applied.updates }))
    } catch {
      setError('Could not tidy the wording. Your text is unchanged.')
    } finally {
      setWorking(false)
    }
  }

  function undo() {
    if (!previous) return
    for (const t of targets) {
      const was = previous[t.key]
      if (was !== undefined) t.onChange(was)
    }
    setPrevious(null)
    // Back to each field's own baseline, so restored text counts as the
    // doctor's again rather than as something already tidied.
    setTidied({})
  }

  // Undo stays until it is used or the text is rewritten again — a timed
  // disappearance would take the only way back with it while the doctor is
  // still reading what changed.
  if (previous) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-[11px] text-white/90">Wording tidied</span>
        {/* Undo stays plain on purpose. The gradient marks the control that
            calls a model; Undo only puts back what the doctor already had. */}
        <button type="button" onClick={undo}
          className={`${PILL} bg-white/20 text-white border border-white/40`}>
          Undo
        </button>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {error && <span className="text-[11px] text-white/90 truncate max-w-[12rem]">{error}</span>}
      <button
        type="button"
        onClick={formalise}
        disabled={working || !targets.some(t => t.value.trim())}
        title={targets.some(t => t.value.trim()) ? 'Correct grammar and formalise the wording you typed' : 'Type something first'}
        className={`${PILL} text-white`}
        style={AI_GRADIENT}
      >
        {working ? 'Tidying…' : 'AI tidy'}
      </button>
    </div>
  )
}
