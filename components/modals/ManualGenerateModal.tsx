'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

interface ManualGenerateModalProps {
  open: boolean
  // Builds the full prompt (personalisation + template + redacted transcript) to
  // paste into an external AI. Called lazily on copy so it always reflects current state.
  buildPrompt: () => string
  // Applies a pasted AI result to the note fields. Returns false if nothing parseable.
  onApply: (pasted: string) => boolean
  onClose: () => void
}

// Offline escape hatch for when every AI quota is exhausted: copy the prompt into
// the Gemini app or ChatGPT, then paste the result back to fill the note. No API used.
export default function ManualGenerateModal({ open, buildPrompt, onApply, onClose }: ManualGenerateModalProps) {
  const [copied, setCopied] = useState(false)
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCopied(false)
      setPasted('')
      setError(null)
    }
  }, [open])

  async function handleCopy() {
    const text = buildPrompt()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for browsers/contexts where the async clipboard API is blocked.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* nothing else to try */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handleApply() {
    if (!pasted.trim()) {
      setError('Paste the note your AI produced above first.')
      return
    }
    const ok = onApply(pasted)
    if (!ok) {
      setError("Couldn't read a note from that text. Paste the full result the AI gave you.")
      return
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Generate manually" maxWidth="md">
      <div className="px-5 pb-5 space-y-5">
        <p className="text-sm text-[var(--text2)]">
          Out of AI credits? Copy the prompt into the Gemini app or ChatGPT, then paste the
          result back here to fill the note. Nothing leaves your device except the text you copy.
        </p>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--blue-lt)] text-[var(--blue)] text-xs font-semibold shrink-0">1</span>
            <span className="text-sm font-medium text-[var(--text)]">Copy the prompt</span>
          </div>
          <Button variant="secondary" size="md" onClick={handleCopy} className="w-full">
            {copied ? 'Copied — paste into Gemini or ChatGPT' : 'Copy prompt'}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--blue-lt)] text-[var(--blue)] text-xs font-semibold shrink-0">2</span>
            <span className="text-sm font-medium text-[var(--text)]">Paste the AI&apos;s result</span>
          </div>
          <textarea
            value={pasted}
            onChange={e => { setPasted(e.target.value); setError(null) }}
            placeholder="Paste the note the AI generated here…"
            rows={6}
            className="w-full bg-white border border-[var(--border)] rounded-[var(--r-sm)] px-3 py-2.5 text-sm text-[var(--text)] leading-relaxed resize-y focus:outline-none focus:border-[var(--blue)]"
          />
          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          <Button variant="primary" size="md" onClick={handleApply} className="w-full">
            Fill note from result
          </Button>
        </div>
      </div>
    </Modal>
  )
}
