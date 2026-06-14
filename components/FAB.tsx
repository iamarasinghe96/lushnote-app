'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

const SLACK_WEBHOOK = 'https://hooks.slack.com' + '/services/T0B5HRCD3QT/B0B5X3GJYBW/wmD9BaIPKisWj0rQ67vWdmnQ'

const LUSHNOTE_KB = `LushNote is a clinical note builder for psychiatrists.
Features: 116 clinical note templates, voice recording and transcription, AI note generation, patient management, PDF/clipboard/email export, custom templates.
API: Users bring their own Gemini API key (free from aistudio.google.com) and optionally Groq key.
Gemini limit: 20 notes/day free tier. Groq key extends this significantly.
Security: Notes stored in Firebase Firestore, encrypted at rest. Audio is never stored - transcribed then immediately discarded.
Privacy: Transcript redaction available in Settings > Transcripts.
Add to home screen: iOS - tap Share button then "Add to Home Screen". Android - tap the install prompt banner.
Common issues: Generation fails → check API key in Settings > API Keys. Recording won't start → check microphone permissions in browser settings.
Templates: 116 built-in templates across Progress Notes, Assessments, Therapy Notes, Risk & Safety.
Export: PDF (formatted A4), clipboard copy, email via mailto with professional cover letter.
Custom templates: Create in Settings > Templates.
Personalisation: Set your professional identity, treatment approaches, and document style in Settings > Personalisation.`

export function FAB() {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<'ai' | 'support' | null>(null)
  const [aiMessages, setAiMessages] = useState<{ role: string; content: string }[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [supportName, setSupportName] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [supportMessage, setSupportMessage] = useState('')
  const [supportSent, setSupportSent] = useState(false)
  const { user } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages, aiLoading])

  // Close sub-buttons on outside click
  useEffect(() => {
    if (!expanded) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      const fab = document.getElementById('ln-fab-root')
      if (fab && !fab.contains(target)) setExpanded(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [expanded])

  function openPanel(type: 'ai' | 'support') {
    setPanel(type)
    setExpanded(false)
  }

  async function handleAiSend() {
    if (!aiInput.trim() || aiLoading) return
    const question = aiInput.trim()
    setAiInput('')
    setAiMessages(prev => [...prev, { role: 'user', content: question }])
    setAiLoading(true)

    try {
      const groqKey = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('groq_api_key') : null
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (groqKey) headers['x-groq-key'] = groqKey

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'assistant',
          question,
          kb: LUSHNOTE_KB,
          uid: user?.uid,
        }),
      })
      const data = await response.json()
      setAiMessages(prev => [...prev, { role: 'ai', content: data.answer || 'No response.' }])
    } catch {
      setAiMessages(prev => [...prev, { role: 'ai', content: 'Could not reach AI. Check your API key in Settings.' }])
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSupportSubmit() {
    if (!supportMessage.trim()) return
    const payload = {
      text: `*LushNote Support Request*\n*From:* ${supportName || 'Anonymous'} (${supportEmail || user?.email || 'no email'})\n*Message:* ${supportMessage}`,
    }
    try {
      await fetch(SLACK_WEBHOOK, { method: 'POST', body: JSON.stringify(payload), mode: 'no-cors' })
      setSupportSent(true)
    } catch {
      const body = encodeURIComponent(`From: ${supportName}\nEmail: ${supportEmail}\n\n${supportMessage}`)
      window.location.href = `mailto:iamarasinghe96@gmail.com?subject=LushNote Support&body=${body}`
    }
  }

  return (
    <>
      {/* FAB button + sub-buttons */}
      <div id="ln-fab-root" className="fixed bottom-20 right-4 z-[60] flex flex-col items-end gap-2">
        {expanded && (
          <>
            <button
              onClick={() => openPanel('support')}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-[var(--text)]
                         border border-[var(--border)] motion-safe:transition-transform motion-safe:active:scale-[0.97]"
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
              }}
            >
              Live Support
            </button>
            <button
              onClick={() => openPanel('ai')}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-[var(--text)]
                         border border-[var(--border)] motion-safe:transition-transform motion-safe:active:scale-[0.97]"
              style={{
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
              }}
            >
              AI Assistant
            </button>
          </>
        )}
        <button
          onClick={() => setExpanded(o => !o)}
          className="w-14 h-14 rounded-full text-white flex items-center justify-center
                     motion-safe:transition-colors motion-safe:active:scale-[0.97]"
          style={{
            background: '#10b981',
            boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
          }}
          aria-label="Open chat"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      {/* AI Assistant panel */}
      {panel === 'ai' && (
        <div className="fixed inset-0 z-[50] flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)' }}>
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0"
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
          >
            <span className="font-semibold text-[var(--text)]">AI Assistant</span>
            <button
              onClick={() => setPanel(null)}
              className="text-[var(--text3)] hover:text-[var(--text)] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg)] motion-safe:transition-colors"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {aiMessages.length === 0 && (
              <p className="text-sm text-[var(--text3)] text-center mt-8">
                Ask me anything about LushNote, or ask about a patient.
              </p>
            )}
            {aiMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-[var(--r-lg)] px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-[var(--blue)] text-white rounded-br-sm'
                    : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm'
                }`}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            {aiLoading && (
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

          <div
            className="border-t border-[var(--border)] p-3 flex gap-2 shrink-0"
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
          >
            <input
              type="text"
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAiSend()}
              placeholder="Ask a question..."
              className="flex-1 text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white
                         focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
            <button
              onClick={handleAiSend}
              disabled={aiLoading || !aiInput.trim()}
              className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)] disabled:opacity-50
                         motion-safe:transition-transform motion-safe:active:scale-[0.97]"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Live Support panel */}
      {panel === 'support' && (
        <div className="fixed inset-0 z-[50] flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)' }}>
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0"
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
          >
            <span className="font-semibold text-[var(--text)]">Live Support</span>
            <button
              onClick={() => setPanel(null)}
              className="text-[var(--text3)] hover:text-[var(--text)] w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--bg)] motion-safe:transition-colors"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {supportSent ? (
              <div className="text-center mt-16">
                <div className="w-16 h-16 rounded-full bg-[#d1fae5] flex items-center justify-center mx-auto mb-4">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" aria-hidden>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <p className="font-semibold text-[var(--text)]">Message sent!</p>
                <p className="text-sm text-[var(--text2)] mt-2">We&apos;ll get back to you shortly.</p>
              </div>
            ) : (
              <div className="space-y-4 max-w-md mx-auto">
                <p className="text-sm text-[var(--text2)]">Send us a message and we&apos;ll respond as soon as possible.</p>
                <input
                  placeholder="Your name"
                  value={supportName}
                  onChange={e => setSupportName(e.target.value)}
                  className="w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white
                             focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
                />
                <input
                  placeholder="Your email"
                  type="email"
                  value={supportEmail}
                  onChange={e => setSupportEmail(e.target.value)}
                  className="w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white
                             focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
                />
                <textarea
                  placeholder="How can we help?"
                  rows={6}
                  value={supportMessage}
                  onChange={e => setSupportMessage(e.target.value)}
                  className="w-full text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white resize-none
                             focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
                />
                <button
                  onClick={handleSupportSubmit}
                  disabled={!supportMessage.trim()}
                  className="w-full bg-[var(--blue)] text-white text-sm font-medium py-3 rounded-[var(--r)] disabled:opacity-50
                             motion-safe:transition-transform motion-safe:active:scale-[0.97]"
                >
                  Send Message
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
