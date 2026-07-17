'use client'

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { listNotes } from '@/lib/firestore/notes'
import { getGroqKey } from '@/lib/utils'
import type { Note } from '@/types'

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

const STOP_WORDS = new Set([
  'the', 'who', 'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from',
  'had', 'has', 'have', 'was', 'were', 'did', 'does', 'and', 'for', 'are', 'is',
  'his', 'her', 'their', 'they', 'she', 'him', 'you', 'your', 'about', 'tell',
  'how', 'many', 'much', 'patient', 'patients', 'session', 'sessions', 'note',
  'notes', 'one', 'any', 'all', 'name', 'there', 'been', 'kind', 'like',
])

const SNIPPET_FIELDS: (keyof Note)[] = [
  'transcript', 'presentation', 'history', 'content', 'summary', 'mse', 'risk', 'nextsteps',
]

const CONTEXT_CHAR_CAP = 16000

// Builds the clinical context the assistant answers from: every note gets a
// header (patient/date/diagnosis) and summary, and notes whose text matches
// the question's keywords also get excerpt windows around each match — this is
// what lets the model answer transcript-detail questions ("the patient whose
// friend...") without shipping whole transcripts to the AI.
function buildNotesContext(question: string, notes: Note[]): string {
  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))

  const entries = notes.map(note => {
    const diagnosis = (note.diagnosis ?? '').replace(/\s+/g, ' ').slice(0, 150)
    const reg = (note.reg_number ?? '').trim()
    const header = `Patient: ${note.patient ?? 'Unknown'}${reg ? ` | Reg: ${reg}` : ''} | Date: ${note.date ?? '?'}${diagnosis ? ` | Diagnosis: ${diagnosis}` : ''}`
    const summary = ((note.summary || note.presentation || '') as string).replace(/\s+/g, ' ').slice(0, 200)

    const snippets: string[] = []
    for (const field of SNIPPET_FIELDS) {
      if (snippets.length >= 4) break
      const text = (note[field] as string) || ''
      if (!text) continue
      const lower = text.toLowerCase()
      for (const word of keywords) {
        if (snippets.length >= 4) break
        let idx = lower.indexOf(word)
        while (idx !== -1 && snippets.length < 4) {
          const start = Math.max(0, idx - 120)
          const end = Math.min(text.length, idx + word.length + 120)
          snippets.push(text.slice(start, end).replace(/\s+/g, ' '))
          idx = lower.indexOf(word, end)
        }
      }
    }

    const parts = [header]
    if (summary) parts.push(`Summary: ${summary}`)
    if (snippets.length) parts.push(`Excerpts: …${snippets.join('… | …')}…`)
    return { hits: snippets.length, text: parts.join('\n') }
  })

  // Keyword-matched notes first so they survive the cap; ties keep recency order
  entries.sort((a, b) => b.hits - a.hits)

  const out: string[] = []
  let total = 0
  for (const e of entries) {
    if (total + e.text.length > CONTEXT_CHAR_CAP) {
      if (e.hits === 0) break
      continue
    }
    out.push(e.text)
    total += e.text.length
  }
  return out.join('\n---\n')
}

// Turn any mention of a known patient name in an AI answer into a clickable
// link that opens that patient's overview. Names are matched at word
// boundaries, longest first so a full name wins over a first name.
function linkifyPatients(text: string, names: string[], onNameClick: (name: string) => void): ReactNode[] {
  if (!names.length) return [text]
  const sorted = [...names].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const rx = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = rx.exec(text)) !== null) {
    const matched = m[0]
    // Only linkify a capitalised occurrence — a patient named "Psychosis" links,
    // but the word "psychosis" in "history of psychosis" stays plain text.
    const isProperNoun = matched[0] !== matched[0].toLowerCase()
    if (!isProperNoun) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    const canonical = names.find(n => n.toLowerCase() === matched.toLowerCase()) ?? matched
    out.push(
      <button
        key={`p${k++}`}
        type="button"
        onClick={() => onNameClick(canonical)}
        className="text-[var(--blue)] font-medium underline underline-offset-2 hover:opacity-80"
      >
        {matched}
      </button>
    )
    last = m.index + matched.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface ChatMessage {
  role: string
  content: string
}

interface SupportMessage {
  role: string
  text: string
  ts: string
}

export function FAB() {
  const pathname = usePathname()
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<'ai' | 'support' | null>(null)
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([])
  const [patientNames, setPatientNames] = useState<string[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([])
  const [supportInput, setSupportInput] = useState('')
  const [supportSending, setSupportSending] = useState(false)
  const [supportTwoWay, setSupportTwoWay] = useState<boolean | null>(null)
  const { user, profile } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const supportEndRef = useRef<HTMLDivElement>(null)
  const notesCacheRef = useRef<{ notes: Note[]; fetchedAt: number } | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages, aiLoading])

  useEffect(() => {
    supportEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [supportMessages])

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

  const pollSupport = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll', uid: user.uid }),
      })
      const data = await res.json() as { twoWay: boolean; messages?: SupportMessage[] }
      setSupportTwoWay(data.twoWay)
      if (data.twoWay && data.messages) setSupportMessages(data.messages)
    } catch {
      // transient network failure - next poll retries
    }
  }, [user])

  // Load the support thread when the panel opens, then poll for admin replies
  useEffect(() => {
    if (panel !== 'support' || !user) return
    pollSupport()
    const interval = setInterval(pollSupport, 5000)
    return () => clearInterval(interval)
  }, [panel, user, pollSupport])

  function openPanel(type: 'ai' | 'support') {
    setPanel(type)
    setExpanded(false)
  }

  // Open a patient's overview from a linkified name in an AI answer. Dispatch an
  // event for the Patients page if it's already mounted, and navigate with a
  // ?patient= param that the page reads on a fresh mount — covers both cases.
  function handlePatientClick(name: string) {
    setPanel(null)
    setExpanded(false)
    window.dispatchEvent(new CustomEvent('ln-open-patient', { detail: { name } }))
    router.push('/patients?patient=' + encodeURIComponent(name))
  }

  async function getNotes(): Promise<Note[]> {
    if (!user) return []
    const cache = notesCacheRef.current
    if (cache && Date.now() - cache.fetchedAt < 60000) return cache.notes
    const notes = await listNotes(user.uid)
    notesCacheRef.current = { notes, fetchedAt: Date.now() }
    return notes
  }

  async function handleAiSend() {
    if (!aiInput.trim() || aiLoading) return
    const question = aiInput.trim()
    setAiInput('')
    const history = aiMessages.slice(-8)
    setAiMessages(prev => [...prev, { role: 'user', content: question }])
    setAiLoading(true)

    try {
      const notes = await getNotes().catch(() => [] as Note[])
      // Unique patient names so the answer can linkify each one to its overview.
      setPatientNames(Array.from(new Set(
        notes.map(n => (n.patient ?? '').trim()).filter(name => name.length > 1)
      )))
      const notesContext = buildNotesContext(question, notes)

      const groqKey = getGroqKey()
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
          notesContext,
          history,
        }),
      })
      const data = await response.json()
      setAiMessages(prev => [...prev, { role: 'ai', content: data.answer || data.error || 'No response.' }])
    } catch {
      setAiMessages(prev => [...prev, { role: 'ai', content: 'Could not reach AI. Check your API key in Settings.' }])
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSupportSend() {
    if (!supportInput.trim() || supportSending || !user) return
    const message = supportInput.trim()
    setSupportInput('')
    setSupportSending(true)
    setSupportMessages(prev => [...prev, { role: 'user', text: message, ts: `local-${Date.now()}` }])

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          uid: user.uid,
          name: profile?.displayName ?? '',
          email: user.email ?? '',
          message,
        }),
      })
      const data = await res.json() as { twoWay: boolean; error?: string }
      if (data.error) throw new Error(data.error)
      setSupportTwoWay(data.twoWay)
      if (data.twoWay) {
        pollSupport()
      } else {
        setSupportMessages(prev => [...prev, {
          role: 'support',
          text: "Message received. We'll get back to you by email shortly.",
          ts: `local-${Date.now()}`,
        }])
      }
    } catch {
      setSupportMessages(prev => [...prev, {
        role: 'support',
        text: 'Message could not be sent. Please email iamarasinghe96@gmail.com directly.',
        ts: `local-${Date.now()}`,
      }])
    } finally {
      setSupportSending(false)
    }
  }

  if (pathname === '/transcript') return null

  return (
    <>
      {/* FAB button + sub-buttons */}
      <div id="ln-fab-root" className="fixed right-4 z-[60] flex flex-col items-end gap-2" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}>
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
        <div className="fixed inset-0 z-[110] flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', paddingTop: 'env(safe-area-inset-top)' }}>
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
              <div className="text-center mt-8 space-y-2">
                <p className="text-sm text-[var(--text3)]">
                  Ask about LushNote, or ask about your patients.
                </p>
                <p className="text-xs text-[var(--text3)]">
                  e.g. &quot;Who is the patient with PTSD from a car accident?&quot;<br />
                  &quot;How many of my patients have anxiety?&quot;
                </p>
              </div>
            )}
            {aiMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-[var(--r-lg)] px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-[var(--blue)] text-white rounded-br-sm'
                    : 'bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-bl-sm'
                }`}>
                  <p className="whitespace-pre-wrap">
                    {m.role === 'ai' ? linkifyPatients(m.content, patientNames, handlePatientClick) : m.content}
                  </p>
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
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
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
        <div className="fixed inset-0 z-[110] flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', paddingTop: 'env(safe-area-inset-top)' }}>
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0"
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
          >
            <div>
              <span className="font-semibold text-[var(--text)]">Live Support</span>
              {supportTwoWay && (
                <p className="text-[11px] text-[var(--text3)]">Replies appear here as they arrive</p>
              )}
            </div>
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
            {supportMessages.length === 0 && (
              <p className="text-sm text-[var(--text3)] text-center mt-8">
                Need help? Send us a message and chat with the LushNote team.
              </p>
            )}
            {supportMessages.map((m) => (
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
            <div ref={supportEndRef} />
          </div>

          <div
            className="border-t border-[var(--border)] p-3 flex gap-2 shrink-0"
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
          >
            <input
              type="text"
              value={supportInput}
              onChange={e => setSupportInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSupportSend()}
              placeholder="Type a message..."
              className="flex-1 text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white
                         focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
            />
            <button
              onClick={handleSupportSend}
              disabled={supportSending || !supportInput.trim()}
              className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)] disabled:opacity-50
                         motion-safe:transition-transform motion-safe:active:scale-[0.97]"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
