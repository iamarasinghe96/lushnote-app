'use client'

import { useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSupportThread } from '@/hooks/useSupportThread'

// Live Support, as a Settings panel.
//
// It holds no state of its own — the thread lives in SupportThreadProvider at
// the root, so a reply that arrives while the doctor is anywhere else in the app
// still raises the badge. This is the view; the conversation outlives it.

export default function SupportPanel() {
  const { profile } = useAuth()
  const {
    messages, input, setInput, sending, stage, topic, ticket, yesNo, escalated,
    awaitingDescription, setPanelOpen, topics, pickTopic, answerYesNo, submitInput, endChat,
  } = useSupportThread()
  const listRef = useRef<HTMLDivElement>(null)

  // Tell the provider the panel is visible: it clears the badge, polls faster
  // for live replies, and advances the server-side read marker instead of
  // badging. On unmount it goes back to the quiet background cadence.
  useEffect(() => {
    setPanelOpen(true)
    return () => setPanelOpen(false)
  }, [setPanelOpen])

  // Follow the latest message inside the conversation box only. scrollIntoView
  // also scrolled the Settings page itself, carrying the header and its End
  // chat button out of view on every new line.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, yesNo])

  const canEnd = messages.length > 0 || escalated

  return (
    <div className="max-w-2xl">
      {/* Pinned to the top of the Settings scroll area, so End chat stays in
          reach however long the conversation gets. On phones it sits below
          the tab strip, which overlays the first 48px. Settings already titles
          the page, so this carries only the ticket line. */}
      <div className="sticky top-[48px] sm:top-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-2 mb-2 bg-[var(--bg)]
                      flex items-center justify-between gap-3 min-h-[52px]">
        <p className="text-xs text-[var(--text3)] min-w-0">
          {ticket
            ? `Ticket ${ticket} · replies appear here`
            : escalated
              ? 'Replies appear here as they arrive'
              : 'We’re here to help'}
        </p>
        {canEnd && (
          <button
            onClick={endChat}
            className="shrink-0 text-sm font-medium text-white bg-[var(--danger)] px-4 py-2 rounded-[var(--r)] shadow-sm
                       hover:opacity-90 motion-safe:transition-transform motion-safe:active:scale-[0.97]"
          >
            End chat
          </button>
        )}
      </div>

      <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white overflow-hidden">
        <div ref={listRef} className="min-h-[18rem] max-h-[26rem] overflow-y-auto p-4 space-y-3">
          {stage === 'menu' && messages.length === 0 && (
            <p className="text-sm text-[var(--text3)] text-center mt-2">
              Hi{profile?.displayName ? `, ${profile.displayName.split(' ')[0]}` : ''}! What can we help you with?
            </p>
          )}

          {messages.map(m => (
            <div key={m.ts} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-[var(--r-lg)] px-4 py-3 text-sm ${
                m.role === 'user'
                  ? 'bg-[var(--blue)] text-white rounded-br-sm'
                  : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm'
              }`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            </div>
          ))}

          {sending && (
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

          {/* Step 1: canned topic menu (no AI) */}
          {stage === 'menu' && !sending && (
            <div className="flex flex-col gap-2 pt-1">
              {topics.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => pickTopic(t)}
                  className="text-left text-sm text-[var(--text)] bg-[var(--bg)] border border-[var(--border)]
                             rounded-[var(--r)] px-3 py-2.5 hover:border-[var(--blue)]/50 hover:bg-white
                             motion-safe:transition-colors motion-safe:active:scale-[0.99]"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Step 3: did the AI answer solve it? */}
          {yesNo && !sending && (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-xs text-[var(--text3)] text-center">Did this solve your issue?</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => answerYesNo(true)}
                  className="flex-1 text-sm font-medium text-white bg-[#10b981] rounded-[var(--r)] py-2.5
                             motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                >
                  Yes, solved
                </button>
                <button
                  type="button"
                  onClick={() => answerYesNo(false)}
                  className="flex-1 text-sm font-medium text-[var(--text)] bg-[var(--bg)] border border-[var(--border)]
                             rounded-[var(--r)] py-2.5 hover:border-[var(--blue)]/50 motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                >
                  No, still need help
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input — shown only when we're expecting free text (describe / live chat) */}
        {stage === 'chat' && !yesNo && (
          <div className="border-t border-[var(--border)] p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submitInput()}
              placeholder={awaitingDescription ? 'Describe it…' : 'Type a message…'}
              className="flex-1 text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white
                         focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
            <button
              onClick={submitInput}
              disabled={sending || !input.trim()}
              className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)] disabled:opacity-50
                         motion-safe:transition-transform motion-safe:active:scale-[0.97]"
            >
              Send
            </button>
          </div>
        )}
      </div>

      {topic && stage === 'chat' && (
        <p className="text-xs text-[var(--text3)] mt-3 truncate">Topic: {topic}</p>
      )}
    </div>
  )
}
