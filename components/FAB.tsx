'use client'

import { useEffect, useRef, useState, useCallback, Fragment, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { LUSHNOTE_KB } from '@/lib/supportKb'
import { listNotes } from '@/lib/firestore/notes'
import { getGroqKey } from '@/lib/utils'
import type { Note } from '@/types'


// Tappable starter questions shown in the empty AI Assistant — a mix of app
// FAQ, functionality/how-to, privacy/policy, and patient-recall examples.
const SAMPLE_QUESTIONS: { group: string; items: string[] }[] = [
  {
    group: 'Getting started',
    items: [
      'How do I create a note from a recording?',
      'How do I add my Gemini API key?',
      'How do I write a referral letter?',
    ],
  },
  {
    group: 'Features & how-to',
    items: [
      'How do I make a custom template?',
      'How do I export a note as a PDF?',
      'How do I change my credentials?',
    ],
  },
  {
    group: 'Privacy & data',
    items: [
      'Is my audio recording saved anywhere?',
      'Who can see my patient notes?',
      'How do I delete my account and all my data?',
    ],
  },
  {
    group: 'Your patients',
    items: [
      'Who is the patient with PTSD from a car accident?',
      'How many of my patients have anxiety?',
    ],
  },
]

// Canned first-step topics for Live Support (no AI at this stage).


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

// "Settings > <Tab>" phrases the assistant emits → the matching deep-link tab.
const SETTINGS_TAB_BY_LABEL: Record<string, string> = {
  'personalisation': 'personalisation',
  'api keys': 'api-keys',
  'transcripts': 'transcripts',
  'templates': 'templates',
  'workplaces': 'workplaces',
  'profile': 'profile',
  'subscription': 'subscription',
}
// Main tab/section names → their route. Only linked when qualified by
// tab/section/screen/page/view so ordinary verbs ("edit the note") aren't touched.
const TAB_ROUTE: Record<string, string> = {
  generate: '/generate', edit: '/edit', export: '/export',
  history: '/history', patients: '/patients', transcript: '/transcript',
}
// Order matters (alternation is tried left-to-right at each position): the
// specific "Settings > Tab" wins over a qualified main tab, which wins over a
// bare "Settings".
const NAV_RX = /Settings\s*[>›→]\s*(Personalisation|API Keys|Transcripts|Templates|Workplaces|Profile|Subscription)|(Generate|Edit|Export|History|Patients|Transcript)\s+(?:tab|section|screen|page|view)|\bSettings\b/gi

// Turn any in-app destination the assistant names ("Settings > API Keys", the
// "Patients tab", "Settings", …) into a clickable link to that route/tab.
function linkifyNav(text: string, onNav: (href: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0, k = 0
  let m: RegExpExecArray | null
  NAV_RX.lastIndex = 0
  while ((m = NAV_RX.exec(text)) !== null) {
    let href: string | undefined
    if (m[1]) { const tab = SETTINGS_TAB_BY_LABEL[m[1].toLowerCase()]; if (tab) href = '/settings?tab=' + tab }
    else if (m[2]) href = TAB_ROUTE[m[2].toLowerCase()]
    else href = '/settings'
    if (!href) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    const to = href
    out.push(
      <button
        key={`n${k++}`}
        type="button"
        onClick={() => onNav(to)}
        className="text-[var(--blue)] font-medium underline underline-offset-2 hover:opacity-80"
      >
        {m[0]}
      </button>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// Compose both linkifiers: nav destinations first, patient names within the
// remaining plain-text runs. Keys are namespaced per run so siblings stay unique.
function linkifyMessage(
  text: string, names: string[], onName: (n: string) => void, onNav: (href: string) => void,
): ReactNode[] {
  const out: ReactNode[] = []
  linkifyNav(text, onNav).forEach((part, i) => {
    if (typeof part !== 'string') { out.push(<Fragment key={`n${i}`}>{part}</Fragment>); return }
    linkifyPatients(part, names, onName).forEach((node, j) => {
      out.push(typeof node === 'string' ? node : <Fragment key={`${i}-${j}`}>{node}</Fragment>)
    })
  })
  return out
}

interface ChatMessage {
  role: string
  content: string
}


// `whitespace-nowrap` and `shrink-0` are what keep the row a ROW: without them
// flexbox squeezes the labels into two lines each and the tray grows taller than
// the button it came out of.
const SUB_BTN = `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2
                 text-xs font-medium text-[var(--text)] border border-[var(--border)]
                 pointer-events-auto motion-safe:transition-transform motion-safe:active:scale-[0.97]`

// Staggered so they fan out rather than appearing at once. Reduced motion is
// honoured by the global clamp, which zeroes delay as well as duration — the
// buttons are present and usable either way.
function subStyle(delayMs: number): React.CSSProperties {
  return {
    background: 'rgba(255,255,255,0.85)',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
    animation: 'fab-slide-in 0.18s cubic-bezier(0.22,1,0.36,1) both',
    animationDelay: `${delayMs}ms`,
    // The tray runs to the RIGHT of the button, so it grows from its left edge.
    transformOrigin: 'left center',
  }
}

const RecordIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
  </svg>
)

const CaptureIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
)

// Two concave four-point sparkles — the shape that reads as "AI" rather than as
// "chat". Filled, because a stroked sparkle at 16px collapses into a smudge.
function AiStars({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 2c.35 3.4 1 5.65 2.15 6.85S15.6 10.65 19 11c-3.4.35-5.65 1-6.85 2.15S10.35 16.6 10 20c-.35-3.4-1-5.65-2.15-6.85S4.4 11.35 1 11c3.4-.35 5.65-1 6.85-2.15S9.65 5.4 10 2Z" />
      <path d="M18 13.5c.18 1.7.5 2.83 1.08 3.42S20.8 17.82 22.5 18c-1.7.18-2.83.5-3.42 1.08S18.18 20.8 18 22.5c-.18-1.7-.5-2.83-1.08-3.42S15.2 18.18 13.5 18c1.7-.18 2.83-.5 3.42-1.08S17.82 15.2 18 13.5Z" />
    </svg>
  )
}

const AssistantIcon = <AiStars size={14} />

export function FAB() {
  const pathname = usePathname()
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<'ai' | null>(null)
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([])
  const [patientNames, setPatientNames] = useState<string[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const { user, profile } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const notesCacheRef = useRef<{ notes: Note[]; fetchedAt: number } | null>(null)
  const panelRef = useRef(panel)
  panelRef.current = panel


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


  function openPanel(type: 'ai') {
    setPanel(type)
    setExpanded(false)
  }

  // The capture modals live on the generate page, together with the state
  // machine that turns their output into a document. Deep-linking reuses all of
  // it rather than wiring a second copy here — same shape as the ?recover=1
  // link from Patients. What changes is only that a doctor can start a capture
  // from anywhere instead of navigating to Generate first.
  function startCapture(kind: 'record' | 'photo') {
    setExpanded(false)
    // The Generate page may ALREADY be mounted — tapping this from the Generate
    // tab is the commonest case there is — and pushing the route it is already
    // on does not remount it, so its `?capture=` mount effect never runs and the
    // button appears dead. Same shape as handlePatientClick above: an event for
    // the mounted page, a query parameter for a fresh one.
    //
    // The listener marks the event handled, so exactly one of the two fires.
    // Keying on "did anyone answer" rather than on the pathname means this stays
    // correct if the capture modals ever move to another route.
    const detail: { kind: 'record' | 'photo'; handled: boolean } = { kind, handled: false }
    window.dispatchEvent(new CustomEvent('ln-capture', { detail }))
    if (!detail.handled) router.push(`/generate?capture=${kind}`)
  }

  // Open the AI assistant automatically when arriving from a "ask the AI agent"
  // link elsewhere (e.g. the Terms page), which sets this flag before navigating.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('ln-open-assistant') === '1') {
        sessionStorage.removeItem('ln-open-assistant')
        setPanel('ai')
      }
    } catch { /* ignore */ }
  }, [])

  // Open a patient's overview from a linkified name in an AI answer. Dispatch an
  // event for the Patients page if it's already mounted, and navigate with a
  // ?patient= param that the page reads on a fresh mount — covers both cases.
  function handlePatientClick(name: string) {
    setPanel(null)
    setExpanded(false)
    window.dispatchEvent(new CustomEvent('ln-open-patient', { detail: { name } }))
    router.push('/patients?patient=' + encodeURIComponent(name))
  }

  function handleNavClick(href: string) {
    setPanel(null)
    setExpanded(false)
    router.push(href)
  }

  async function getNotes(): Promise<Note[]> {
    if (!user) return []
    const cache = notesCacheRef.current
    if (cache && Date.now() - cache.fetchedAt < 60000) return cache.notes
    const notes = await listNotes(user.uid)
    notesCacheRef.current = { notes, fetchedAt: Date.now() }
    return notes
  }

  async function handleAiSend(preset?: string) {
    const question = (typeof preset === 'string' ? preset : aiInput).trim()
    if (!question || aiLoading) return
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



  if (pathname === '/transcript') return null

  return (
    <>
      {/* FAB button + sub-buttons */}
      {/* Bottom-LEFT. items-start and the transform origins below go with it —
          left-aligned sub-buttons that still expand out of the button rather
          than away from it. */}
      {/* Bottom-LEFT, and the tray runs RIGHT from the button along the empty
          strip above the tab bar. It used to stack upwards, which put three
          opaque pills on top of the mode cards — the very things the doctor is
          choosing between.

          `right-4` bounds the row to the viewport so a narrow phone cannot push
          the last button off-screen; that makes the container full-width, so it
          is `pointer-events-none` and each button re-enables its own, or an
          invisible strip would swallow taps meant for the page. */}
      <div
        id="ln-fab-root"
        className="fixed left-4 right-4 z-[60] flex items-center gap-2 pointer-events-none"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}
      >
        <button
          onClick={() => setExpanded(o => !o)}
          className="relative w-14 h-14 shrink-0 rounded-full text-white flex items-center justify-center
                     pointer-events-auto motion-safe:transition-colors motion-safe:active:scale-[0.97]"
          style={{
            background: '#10b981',
            boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
          }}
          aria-label={expanded ? 'Close capture menu' : 'Open capture menu'}
          aria-expanded={expanded}
        >
          <AiStars size={26} />
        </button>
        {expanded && (
          // Order matters: the two capture actions sit CLOSEST to the button,
          // because they are why a doctor reaches for it mid-clinic. The
          // assistant is the occasional one and sits furthest away. The row
          // reads left-to-right, so this list now does too.
          //
          // The overflow is a safety valve for a very narrow phone, not the
          // layout: at any ordinary width all three fit with room to spare.
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none">
            <button
              onClick={() => startCapture('record')}
              className={SUB_BTN}
              style={subStyle(0)}
              aria-label="Record a session"
            >
              {RecordIcon}
              Record
            </button>
            <button
              onClick={() => startCapture('photo')}
              className={SUB_BTN}
              style={subStyle(70)}
              aria-label="Capture a note — camera or photo library"
            >
              {CaptureIcon}
              Capture
            </button>
            <button
              onClick={() => openPanel('ai')}
              className={SUB_BTN}
              style={subStyle(140)}
              aria-label="Open the AI assistant"
            >
              {AssistantIcon}
              Assistant
            </button>
          </div>
        )}
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
              <div className="mt-2 space-y-4">
                <p className="text-sm text-[var(--text3)] text-center">
                  Ask about LushNote — how it works, privacy, or your patients. Tap a question to try it.
                </p>
                {SAMPLE_QUESTIONS.map(({ group, items }) => (
                  <div key={group} className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wide px-1">{group}</p>
                    <div className="flex flex-col gap-1.5">
                      {items.map(q => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => handleAiSend(q)}
                          className="text-left text-sm text-[var(--text)] bg-[var(--bg)] border border-[var(--border)]
                                     rounded-[var(--r)] px-3 py-2 hover:border-[var(--blue)]/50 hover:bg-white
                                     motion-safe:transition-colors motion-safe:active:scale-[0.99]"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
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
                    {m.role === 'ai' ? linkifyMessage(m.content, patientNames, handlePatientClick, handleNavClick) : m.content}
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
              onClick={() => handleAiSend()}
              disabled={aiLoading || !aiInput.trim()}
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
