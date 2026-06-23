'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useNoteStore } from '@/hooks/useNoteStore'
import { useAuth } from '@/hooks/useAuth'

export default function TranscriptPage() {
  const { lastTranscript } = useNoteStore()
  const { user } = useAuth()
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string; quote?: string }[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!lastTranscript) router.replace('/generate')
  }, [lastTranscript, router])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  if (!lastTranscript) return null

  const wordCount = lastTranscript.trim().split(/\s+/).filter(Boolean).length

  function parseQAResponse(raw: string): { found: boolean; inferred: boolean; answer: string; quote: string } | null {
    let text = raw.trim()
    // Strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenceMatch) text = fenceMatch[1].trim()
    // Extract first JSON object if prefixed with prose
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) text = jsonMatch[0]
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      let answer = String(obj.answer ?? '')
      // Handle double-encoded: AI put the full JSON object inside the answer field
      if (answer.trimStart().startsWith('{')) {
        try {
          const inner = JSON.parse(answer) as Record<string, unknown>
          if (inner.answer) {
            return { found: Boolean(inner.found ?? true), inferred: Boolean(inner.inferred ?? false), answer: String(inner.answer), quote: String(inner.quote ?? '') }
          }
        } catch { /* keep original */ }
      }
      return { found: Boolean(obj.found ?? true), inferred: Boolean(obj.inferred ?? false), answer, quote: String(obj.quote ?? '') }
    } catch {
      return null
    }
  }

  async function handleAsk() {
    if (!input.trim() || loading) return
    const question = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: question }])
    setLoading(true)

    try {
      const groqKey = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('groq_api_key') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (groqKey) headers['x-groq-key'] = groqKey

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'transcript-qa',
          question,
          transcript: lastTranscript,
          uid: user?.uid,
        }),
      })
      const data = await response.json() as { answer?: string; error?: string }
      if (!data.answer) throw new Error(data.error || 'No response')

      const parsed = parseQAResponse(data.answer)
      if (!parsed) throw new Error('Could not parse response')

      setMessages(prev => [...prev, {
        role: 'ai',
        content: parsed.answer + (parsed.inferred ? '\n\n_(inferred - not directly stated)_' : ''),
        quote: parsed.quote || undefined,
      }])
      if (parsed.quote) trsHighlightQuote(parsed.quote)
    } catch {
      setMessages(prev => [...prev, { role: 'ai', content: 'Could not get an answer. Check your API key in Settings.' }])
    } finally {
      setLoading(false)
    }
  }

  function trsHighlightQuote(quote: string) {
    if (!transcriptRef.current || !quote) return
    const el = transcriptRef.current

    el.querySelectorAll('.trs-hl').forEach(m => {
      const parent = m.parentNode
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ''), m)
        parent.normalize()
      }
    })

    const text = el.textContent || ''
    let matchIdx = text.indexOf(quote)
    let matchStr = quote

    if (matchIdx === -1) {
      const first5 = quote.split(/\s+/).slice(0, 5).join(' ')
      matchIdx = text.indexOf(first5)
      matchStr = first5
    }
    if (matchIdx === -1) return

    setExpanded(true)

    setTimeout(() => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let charCount = 0
      let startNode: Text | null = null
      let startOffset = 0
      let endNode: Text | null = null
      let endOffset = 0

      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        const len = node.textContent?.length || 0
        if (!startNode && charCount + len > matchIdx) {
          startNode = node
          startOffset = matchIdx - charCount
        }
        if (startNode && charCount + len >= matchIdx + matchStr.length) {
          endNode = node
          endOffset = matchIdx + matchStr.length - charCount
          break
        }
        charCount += len
      }

      if (startNode && endNode) {
        const range = document.createRange()
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)
        const mark = document.createElement('mark')
        mark.className = 'trs-hl'
        mark.style.cssText = 'background:#fef08a;border-radius:2px;padding:0 1px;'
        try {
          range.surroundContents(mark)
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } catch (_) {}
      }
    }, 100)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden pb-tabbar">
      {/* Raw transcript section */}
      <div
        className="border-b border-[var(--border)] p-4 flex-none"
        style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-[var(--text)]">Transcript</span>
          <span className="text-xs text-[var(--text3)] bg-[var(--bg)] border border-[var(--border)] rounded-full px-2 py-0.5">
            {wordCount} words
          </span>
        </div>
        <div
          className={`relative text-sm text-[var(--text2)] leading-relaxed whitespace-pre-wrap ${
            !expanded ? 'max-h-28 overflow-hidden' : 'max-h-[22vh] overflow-y-auto'
          }`}
          ref={transcriptRef}
        >
          {lastTranscript}
          {!expanded && (
            <div
              className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
              style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.9), transparent)' }}
            />
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-[var(--blue)] font-medium mt-2"
        >
          {expanded ? 'Show less ↑' : 'Show more ↓'}
        </button>
      </div>

      {/* AI Q&A messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-[var(--text3)] text-center mt-8">
            Ask a question about this transcript.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-[var(--r-lg)] px-4 py-3 text-sm ${
              m.role === 'user'
                ? 'bg-[var(--blue)] text-white rounded-br-sm'
                : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm'
            }`}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.quote && m.role === 'ai' && (
                <p className="text-xs mt-2 text-[var(--text3)] italic border-l-2 border-[var(--border)] pl-2">
                  &ldquo;{m.quote}&rdquo;
                </p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r-lg)] rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-[var(--text3)] rounded-full motion-safe:animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-[var(--text3)] rounded-full motion-safe:animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-[var(--text3)] rounded-full motion-safe:animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="border-t border-[var(--border)] p-3 flex gap-2"
        style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAsk()}
          placeholder="Ask about this transcript..."
          className="flex-1 text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
        />
        <button
          onClick={handleAsk}
          disabled={loading || !input.trim()}
          className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)] disabled:opacity-50 active:scale-[0.97] transition-transform"
        >
          Ask
        </button>
      </div>
    </div>
  )
}
