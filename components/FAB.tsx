'use client'

import { useEffect, useRef, useState, useCallback, Fragment, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { listNotes } from '@/lib/firestore/notes'
import { getGroqKey } from '@/lib/utils'
import type { Note } from '@/types'

const LUSHNOTE_KB = `LushNote is a clinical note builder for clinicians.
Features: 116 clinical note templates, voice recording and transcription, AI note generation, patient management, referral/records/custom letters, hospital progress-note forms, and PDF/clipboard/email/Share export.
API: Users bring their own Gemini API key (free from aistudio.google.com) and optionally a Groq key.
Gemini limit: 20 notes/day free tier. A Groq key extends this significantly.
Templates: 116 built-in templates across Progress Notes, Assessments, Therapy Notes, Risk & Safety. Create your own in Settings > Templates.
Export: PDF (formatted A4), clipboard copy, email, and Share (attaches the PDF file). Print produces the same PDF as the download.
Personalisation: Set your professional identity, treatment approaches, and document style in Settings > Personalisation.
Common issues: Generation fails → check your API key in Settings > API Keys. Recording won't start → check microphone permissions in your browser settings. Recording stops when the phone is locked → iOS suspends web apps when the screen turns off, so keep the screen on during a session.

LushNote official policy (Terms of Service & Privacy Policy) — this is the ONLY source of truth for any privacy, data, security, storage, or terms question. Full policy: https://www.lushnote.com.au/terms
- Audio recordings: audio is streamed for transcription, converted to text, then immediately discarded. The audio file is NEVER stored, uploaded, or archived. Only the resulting transcript TEXT is kept, saved as part of the note in your account; you can review, edit, or delete it like any other note content.
- Clinical notes & letters: stored securely and encrypted, accessible only by you. No LushNote team member, developer, or administrator can view your patient data — there is no admin view.
- AI training: your notes, transcripts, and patient information are NEVER used to train or improve any AI model. Data is sent to AI providers only to fulfil your immediate request.
- Transcript redaction: optional (Settings > Transcripts) — removes patient names, DOB, phone numbers, and other identifiers before anything is sent to an AI provider.
- Account deletion: delete your account any time from Settings > Profile; all notes, patient profiles, and account details are permanently and irreversibly removed (no backups).
- Compliance: designed to comply with the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles; governed by Australian law.
- API keys: your Gemini/Groq keys are stored securely and used only for AI requests on your behalf.
- Contact: admin@lushnote.com.au.`

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
const SUPPORT_TOPICS: { key: string; label: string; prompt: string }[] = [
  { key: 'bug', label: 'Report a bug', prompt: 'Please describe the bug in a few sentences — what you did, what happened, and paste any error message you saw.' },
  { key: 'feature', label: 'Feature or UX suggestion', prompt: "Great — tell us your idea in a few sentences: what you'd like and why it would help." },
  { key: 'question', label: 'Ask a question', prompt: "Sure — describe your question in a sentence or two and we'll help." },
  { key: 'account', label: 'Account or privacy', prompt: 'Please describe your account or privacy question in a few sentences.' },
  { key: 'other', label: 'Something else', prompt: 'Please describe what you need help with, and paste any error you saw.' },
]

// Short chime when a new human reply arrives while the support chat is closed.
function playSupportChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.value = 880
    o.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    o.start(); o.stop(ctx.currentTime + 0.36)
    o.onended = () => ctx.close()
  } catch { /* audio not available */ }
}

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
  const [supportStage, setSupportStage] = useState<'menu' | 'chat'>('menu')
  const [supportTopic, setSupportTopic] = useState('')
  const [supportTicket, setSupportTicket] = useState<string | null>(null)
  const [supportYesNo, setSupportYesNo] = useState(false)
  const [supportEscalated, setSupportEscalated] = useState(false)
  const [awaitingDescription, setAwaitingDescription] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const { user, profile } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const supportEndRef = useRef<HTMLDivElement>(null)
  const notesCacheRef = useRef<{ notes: Note[]; fetchedAt: number } | null>(null)
  const seenSupportTsRef = useRef<Set<string>>(new Set())
  const threadActiveRef = useRef(false)
  const primedRef = useRef(false)
  const localSeqRef = useRef(0)
  const panelRef = useRef(panel)
  panelRef.current = panel

  const pushSupport = useCallback((role: 'user' | 'support', text: string) => {
    setSupportMessages(prev => [...prev, { role, text, ts: `local-${Date.now()}-${localSeqRef.current++}` }])
  }, [])

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

  // Tell the server the doctor has read up to this Slack ts, so already-seen
  // replies don't come back as "unread" on the next fresh page load.
  const markSupportRead = useCallback(async (ts: string) => {
    if (!user || !ts) return
    try {
      await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markRead', uid: user.uid, ts }),
      })
    } catch { /* best-effort; next open retries */ }
  }, [user])

  // Poll the Slack thread for human replies. A FRESH page load never replays the
  // whole thread — the doctor lands on the clean topic menu and only genuinely
  // new admin replies (newer than their server-side read marker) surface. Within
  // a session we append only unseen admin messages, so local bot/doctor messages
  // are never clobbered. A new reply while the chat is closed raises the badge +
  // chime; while the panel is open we advance the read marker.
  const pollSupport = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll', uid: user.uid }),
      })
      const data = await res.json() as { twoWay: boolean; messages?: SupportMessage[]; threadExists?: boolean; ticket?: string | null; lastReadTs?: string | null }
      setSupportTwoWay(data.twoWay)
      if (data.threadExists) threadActiveRef.current = true
      if (data.ticket) setSupportTicket(prev => prev ?? data.ticket ?? null)
      if (!data.twoWay || !data.messages) return

      const seen = seenSupportTsRef.current
      const admin = data.messages.filter(m => m.role === 'support')
      const panelOpen = panelRef.current === 'support'
      let newestTs = ''
      for (const m of data.messages) {
        if (!newestTs || parseFloat(m.ts) > parseFloat(newestTs)) newestTs = m.ts
      }

      if (!primedRef.current) {
        primedRef.current = true
        data.messages.forEach(m => seen.add(m.ts))
        const lastRead = data.lastReadTs ? parseFloat(data.lastReadTs) : null
        const unread = lastRead === null ? [] : admin.filter(m => parseFloat(m.ts) > lastRead)
        if (unread.length) {
          setSupportMessages(prev => [...prev, ...unread])
          setSupportEscalated(true)
          setSupportStage('chat')
          if (!panelOpen) { setHasUnread(true); playSupportChime() }
        } else if (lastRead === null && newestTs) {
          // Legacy thread with no read marker: catch it up silently so the old
          // (resolved) conversation never resurfaces on future loads.
          markSupportRead(newestTs)
        }
      } else {
        const fresh = admin.filter(m => !seen.has(m.ts))
        data.messages.forEach(m => seen.add(m.ts))
        if (fresh.length) {
          setSupportMessages(prev => [...prev, ...fresh])
          setSupportEscalated(true)
          setSupportStage('chat')
          if (!panelOpen) { setHasUnread(true); playSupportChime() }
        }
      }

      if (panelOpen && newestTs) markSupportRead(newestTs)
    } catch {
      // transient network failure - next poll retries
    }
  }, [user, markSupportRead])

  // Prime once on mount + a light background poll so a reply raises the badge
  // even when the chat is closed (only if the doctor has an active thread).
  useEffect(() => {
    if (!user) return
    pollSupport()
    const id = setInterval(() => {
      if (panelRef.current !== 'support' && threadActiveRef.current) pollSupport()
    }, 20000)
    return () => clearInterval(id)
  }, [user, pollSupport])

  // While the panel is open: clear the badge and poll faster for live replies.
  // We do NOT force the escalated chat view here — a fresh open lands on the
  // clean topic menu; only a genuinely new admin reply (handled in pollSupport)
  // switches to chat, so an old resolved thread never resurfaces.
  useEffect(() => {
    if (panel !== 'support' || !user) return
    setHasUnread(false)
    pollSupport()
    const interval = setInterval(pollSupport, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, user])

  function openPanel(type: 'ai' | 'support') {
    setPanel(type)
    setExpanded(false)
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

  // Step 1: doctor taps a topic (no AI) → we ask for a description.
  function pickTopic(t: typeof SUPPORT_TOPICS[number]) {
    setSupportTopic(t.label)
    setSupportStage('chat')
    setAwaitingDescription(true)
    pushSupport('support', t.prompt)
  }

  // Step 2: doctor describes the issue → AI decides if it can answer or escalate.
  async function submitDescription(text: string) {
    pushSupport('user', text)
    setAwaitingDescription(false)
    setSupportSending(true)
    try {
      // No x-groq-key: support triage runs on LushNote's own Groq key server-side,
      // so it never spends the doctor's Groq/Gemini allowance.
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'support-triage', topic: supportTopic, description: text, kb: LUSHNOTE_KB }),
      })
      const data = await res.json() as { canHelp?: boolean; answer?: string }
      if (data.canHelp && data.answer?.trim()) {
        pushSupport('support', data.answer.trim())
        setSupportYesNo(true)   // ask "did this solve it?"
      } else {
        await escalate()
      }
    } catch {
      await escalate()
    } finally {
      setSupportSending(false)
    }
  }

  // Step 3: yes/no after an AI answer. No → escalate to a human.
  async function answerYesNo(solved: boolean) {
    setSupportYesNo(false)
    if (solved) {
      pushSupport('user', 'Yes, that solved it')
      pushSupport('support', 'Great — glad that sorted it! Pick a topic below any time you need us again.')
      setSupportStage('menu')
    } else {
      pushSupport('user', "No, it didn't help")
      await escalate()
    }
  }

  // Escalate: open/reuse the Slack thread with a ticket number + the transcript.
  async function escalate() {
    if (!user) return
    const transcript = supportMessages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')
    setSupportSending(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'escalate', uid: user.uid, name: profile?.displayName ?? '',
          email: user.email ?? '', topic: supportTopic, transcript,
        }),
      })
      const data = await res.json() as { twoWay: boolean; ticket?: string }
      const ticket = data.ticket ?? null
      setSupportTicket(ticket)
      setSupportEscalated(true)
      setSupportStage('chat')
      threadActiveRef.current = true
      setSupportTwoWay(data.twoWay)
      pushSupport('support', `Thanks — I've passed this to our team.${ticket ? ` Your ticket is ${ticket}.` : ''} We'll reply right here, and you can follow up any time at admin@lushnote.com.au${ticket ? ` quoting ${ticket}` : ''}. Add anything else below.`)
      if (data.twoWay) pollSupport()
    } catch {
      pushSupport('support', "Sorry — I couldn't reach our team just now. Please email admin@lushnote.com.au and we'll help.")
    } finally {
      setSupportSending(false)
    }
  }

  // Post-escalation: doctor's typed message goes to the human thread.
  async function sendToHuman(text: string) {
    if (!user) return
    pushSupport('user', text)
    setSupportSending(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', uid: user.uid, name: profile?.displayName ?? '', email: user.email ?? '', message: text }),
      })
      const data = await res.json() as { twoWay: boolean; error?: string }
      if (data.error) throw new Error(data.error)
      setSupportTwoWay(data.twoWay)
      if (data.twoWay) pollSupport()
      else pushSupport('support', "Message received. We'll get back to you by email shortly.")
    } catch {
      pushSupport('support', 'Message could not be sent. Please email admin@lushnote.com.au directly.')
    } finally {
      setSupportSending(false)
    }
  }

  // End chat: close the Slack thread (fresh ticket next time) and reset to the
  // topic menu so the old conversation no longer shows.
  async function endChat() {
    if (user) {
      try {
        await fetch('/api/support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close', uid: user.uid }),
        })
      } catch { /* reset locally regardless */ }
    }
    setSupportMessages([])
    setSupportStage('menu')
    setSupportTopic('')
    setSupportTicket(null)
    setSupportYesNo(false)
    setSupportEscalated(false)
    setAwaitingDescription(false)
    setSupportInput('')
    setHasUnread(false)
    seenSupportTsRef.current = new Set()
    primedRef.current = true
    threadActiveRef.current = false
  }

  // The input send button — routes to the right step.
  function handleSupportInput() {
    const text = supportInput.trim()
    if (!text || supportSending) return
    setSupportInput('')
    if (awaitingDescription) submitDescription(text)
    else if (supportEscalated) sendToHuman(text)
    else submitDescription(text)
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
          className="relative w-14 h-14 rounded-full text-white flex items-center justify-center
                     motion-safe:transition-colors motion-safe:active:scale-[0.97]"
          style={{
            background: hasUnread ? '#dc2626' : '#10b981',
            boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)',
          }}
          aria-label={hasUnread ? 'Open chat — new reply' : 'Open chat'}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {hasUnread && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-600 border-2 border-white motion-safe:animate-pulse" aria-hidden />
          )}
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

      {/* Live Support panel */}
      {panel === 'support' && (
        <div className="fixed inset-0 z-[110] flex flex-col" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(12px)', paddingTop: 'env(safe-area-inset-top)' }}>
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0"
            style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)' }}
          >
            <div>
              <span className="font-semibold text-[var(--text)]">Live Support</span>
              {supportTicket ? (
                <p className="text-[11px] text-[var(--text3)]">Ticket {supportTicket} · replies appear here</p>
              ) : supportEscalated ? (
                <p className="text-[11px] text-[var(--text3)]">Replies appear here as they arrive</p>
              ) : (
                <p className="text-[11px] text-[var(--text3)]">We&rsquo;re here to help</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(supportMessages.length > 0 || supportEscalated) && (
                <button
                  onClick={endChat}
                  className="text-xs font-medium text-[var(--text3)] hover:text-[var(--danger)] px-2.5 py-1 rounded-full hover:bg-[var(--bg)] motion-safe:transition-colors"
                >
                  End chat
                </button>
              )}
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
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {supportStage === 'menu' && supportMessages.length === 0 && (
              <p className="text-sm text-[var(--text3)] text-center mt-2">
                Hi{profile?.displayName ? `, ${profile.displayName.split(' ')[0]}` : ''}! What can we help you with?
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

            {supportSending && (
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
            {supportStage === 'menu' && !supportSending && (
              <div className="flex flex-col gap-2 pt-1">
                {SUPPORT_TOPICS.map(t => (
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
            {supportYesNo && !supportSending && (
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

            <div ref={supportEndRef} />
          </div>

          {/* Input — shown only when we're expecting free text (describe / live chat) */}
          {supportStage === 'chat' && !supportYesNo && (
            <div
              className="border-t border-[var(--border)] p-3 flex gap-2 shrink-0"
              style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
            >
              <input
                type="text"
                value={supportInput}
                onChange={e => setSupportInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSupportInput()}
                placeholder={awaitingDescription ? 'Describe it…' : 'Type a message…'}
                className="flex-1 text-sm border border-[var(--border)] rounded-[var(--r)] px-3 py-2 bg-white
                           focus:outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10 transition-colors"
              />
              <button
                onClick={handleSupportInput}
                disabled={supportSending || !supportInput.trim()}
                className="bg-[var(--blue)] text-white text-sm font-medium px-4 py-2 rounded-[var(--r)] disabled:opacity-50
                           motion-safe:transition-transform motion-safe:active:scale-[0.97]"
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
