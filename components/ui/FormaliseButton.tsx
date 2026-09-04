'use client'

import { useState } from 'react'
import { getGroqKey } from '@/lib/utils'
import { tidyPreservesStructure } from '@/lib/tidyGuard'

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

interface FormaliseButtonProps {
  /** Current text. The button disables itself when there is nothing to tidy. */
  value: string
  onChange: (next: string) => void
  /** What kind of document this is, so the rewrite matches its register. */
  documentLabel: string
  uid?: string
  className?: string
}

const PILL = 'shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full motion-safe:active:scale-95 motion-safe:transition-transform disabled:opacity-50 disabled:cursor-not-allowed'

export default function FormaliseButton({
  value, onChange, documentLabel, uid, className = '',
}: FormaliseButtonProps) {
  const [working, setWorking] = useState(false)
  const [previous, setPrevious] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function formalise() {
    const raw = value.trim()
    if (!raw || working) return
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
          rawInput: raw,
          prompt: [
            `This is a ${documentLabel} written by the treating doctor.`,
            'Correct grammar, spelling and dictation artefacts, and render it as formal clinical prose.',
            // Each rule below is a failure observed against the real model on
            // 2026-09-04, not a precaution. The list rule is ALSO enforced in
            // code (tidyPreservesStructure) because asking was not enough.
            'Keep every numbered or lettered plan item as its own separate item, including sub-items such as "1a." — never merge a sub-item into its parent.',
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
      // The prompt asks for plan items to be kept separate; this is what makes
      // it true. Observed failure: "1a. cease if delirium settles" folded into
      // item 1, turning four plan steps into three.
      const structure = tidyPreservesStructure(value, result)
      if (!structure.ok) {
        setError(structure.reason!)
        return
      }
      setPrevious(value)
      onChange(result)
    } catch {
      setError('Could not tidy the wording. Your text is unchanged.')
    } finally {
      setWorking(false)
    }
  }

  function undo() {
    if (previous === null) return
    onChange(previous)
    setPrevious(null)
  }

  // Undo stays until it is used or the text is rewritten again — a timed
  // disappearance would take the only way back with it while the doctor is
  // still reading what changed.
  if (previous !== null) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-[11px] text-white/90">Wording tidied</span>
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
        disabled={working || !value.trim()}
        title={value.trim() ? 'Correct grammar and formalise the wording you typed' : 'Type something first'}
        className={`${PILL} bg-white/20 text-white border border-white/40`}
      >
        {working ? 'Tidying…' : 'AI tidy'}
      </button>
    </div>
  )
}
