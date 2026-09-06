'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { LUSHNOTE_KB, SUPPORT_TOPICS, playSupportChime, type SupportTopic } from '@/lib/supportKb'

// Live Support, lifted out of the FAB so it can live in Settings.
//
// The move is not cosmetic. `app/settings/` is a SIBLING of `app/(app)/`, not a
// child — their only shared ancestor is the root layout. So a doctor reading
// Settings and a doctor looking at the app shell are in different React trees,
// and the thread has to be provided above both or they would poll separately and
// disagree about what has been read.
//
// It also has to keep polling while the panel is CLOSED. The badge exists to
// tell a doctor a human replied; if polling only ran while Settings was open,
// the one moment it matters is the one moment it would not run.
//
// The logic below is moved from components/FAB.tsx verbatim — same requests,
// same priming rules, same cadences. Only its home changed.

export interface SupportMessage {
  role: 'user' | 'support'
  text: string
  ts: string
}

interface SupportThread {
  messages: SupportMessage[]
  input: string
  setInput: (v: string) => void
  sending: boolean
  stage: 'menu' | 'chat'
  topic: string
  ticket: string | null
  yesNo: boolean
  escalated: boolean
  awaitingDescription: boolean
  hasUnread: boolean
  /** Whether the panel is on screen. Drives badge-vs-read-marker and the fast
   *  poll — the provider cannot see the panel, so the panel tells it. */
  setPanelOpen: (open: boolean) => void
  topics: SupportTopic[]
  pickTopic: (t: SupportTopic) => void
  answerYesNo: (solved: boolean) => Promise<void>
  submitInput: () => void
  endChat: () => Promise<void>
}

const Ctx = createContext<SupportThread | null>(null)

export function useSupportThread(): SupportThread {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSupportThread must be used inside SupportThreadProvider')
  return ctx
}

export function SupportThreadProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()

  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [twoWay, setTwoWay] = useState<boolean | null>(null)
  const [stage, setStage] = useState<'menu' | 'chat'>('menu')
  const [topic, setTopic] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  const [yesNo, setYesNo] = useState(false)
  const [escalated, setEscalated] = useState(false)
  const [awaitingDescription, setAwaitingDescription] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const seenTsRef = useRef<Set<string>>(new Set())
  const threadActiveRef = useRef(false)
  const primedRef = useRef(false)
  const localSeqRef = useRef(0)
  const panelOpenRef = useRef(panelOpen)
  panelOpenRef.current = panelOpen
  // Mirror of the conversation, updated synchronously so escalate() can build the
  // transcript including a message pushed in the same handler run (React state
  // updates are async, so reading `messages` there misses the latest line).
  const messagesRef = useRef<SupportMessage[]>([])
  // Auto-ends an abandoned support chat after 30 min of no user activity.
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // endChat is referenced by the inactivity timer before it is defined.
  const endChatRef = useRef<() => Promise<void>>(async () => {})

  const push = useCallback((role: 'user' | 'support', text: string) => {
    const msg: SupportMessage = { role, text, ts: `local-${Date.now()}-${localSeqRef.current++}` }
    messagesRef.current = [...messagesRef.current, msg]
    setMessages(prev => [...prev, msg])
  }, [])

  // Tell the server the doctor has read up to this Slack ts, so already-seen
  // replies don't come back as "unread" on the next fresh page load.
  const markRead = useCallback(async (ts: string) => {
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
  const poll = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll', uid: user.uid }),
      })
      const data = await res.json() as { twoWay: boolean; messages?: SupportMessage[]; threadExists?: boolean; ticket?: string | null; lastReadTs?: string | null }
      setTwoWay(data.twoWay)
      if (data.threadExists) threadActiveRef.current = true
      if (data.ticket) setTicket(prev => prev ?? data.ticket ?? null)
      if (!data.twoWay || !data.messages) return

      const seen = seenTsRef.current
      const admin = data.messages.filter(m => m.role === 'support')
      const open = panelOpenRef.current
      let newestTs = ''
      for (const m of data.messages) {
        if (!newestTs || parseFloat(m.ts) > parseFloat(newestTs)) newestTs = m.ts
      }

      if (!primedRef.current) {
        primedRef.current = true
        data.messages.forEach(m => seen.add(m.ts))
        const lastRead = data.lastReadTs ? parseFloat(data.lastReadTs) : null
        // Rehydrate an ONGOING conversation from the thread so a page refresh
        // keeps the history (local bubbles are lost on reload). Ended or
        // auto-ended chats have no thread, so nothing resurfaces — the doctor
        // lands on the clean topic menu. Only rehydrate when we have no local
        // chat yet (a fresh load), never clobbering an in-session conversation.
        if (data.threadExists && data.messages.length && messagesRef.current.length === 0) {
          setMessages(data.messages)
          messagesRef.current = data.messages
          setEscalated(true)
          setStage('chat')
          const hasNewAdmin = lastRead !== null && admin.some(m => parseFloat(m.ts) > lastRead)
          if (hasNewAdmin && !open) { setHasUnread(true); playSupportChime() }
        }
        if (lastRead === null && newestTs) {
          // Legacy thread with no read marker: catch it up so it doesn't badge
          // forever (history is still shown via the rehydration above).
          markRead(newestTs)
        }
      } else {
        const fresh = admin.filter(m => !seen.has(m.ts))
        data.messages.forEach(m => seen.add(m.ts))
        if (fresh.length) {
          setMessages(prev => [...prev, ...fresh])
          setEscalated(true)
          setStage('chat')
          if (!open) { setHasUnread(true); playSupportChime() }
        }
      }

      if (open && newestTs) markRead(newestTs)
    } catch {
      // transient network failure - next poll retries
    }
  }, [user, markRead])

  // Prime once on mount + a light background poll so a reply raises the badge
  // even when the chat is closed (only if the doctor has an active thread).
  // This provider sits in the ROOT layout precisely so this keeps running while
  // the doctor is anywhere in the app, not only inside Settings.
  useEffect(() => {
    if (!user) return
    poll()
    const id = setInterval(() => {
      if (!panelOpenRef.current && threadActiveRef.current) poll()
    }, 20000)
    return () => clearInterval(id)
  }, [user, poll])

  // While the panel is open: clear the badge and poll faster for live replies.
  // We do NOT force the escalated chat view here — a fresh open lands on the
  // clean topic menu; only a genuinely new admin reply (handled in poll)
  // switches to chat, so an old resolved thread never resurfaces.
  useEffect(() => {
    if (!panelOpen || !user) return
    setHasUnread(false)
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, user])

  // Reset the 30-minute inactivity countdown on any user action in the support
  // chat. When it fires the chat auto-ends, closing the Slack thread so the next
  // visit starts fresh.
  const bumpActivity = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    inactivityTimerRef.current = setTimeout(() => { void endChatRef.current() }, 30 * 60 * 1000)
  }, [])

  useEffect(() => () => { if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current) }, [])

  // Escalate: open/reuse the Slack thread with a ticket number + the transcript.
  const escalate = useCallback(async () => {
    if (!user) return
    const transcript = messagesRef.current
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')
    setSending(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'escalate', uid: user.uid, name: profile?.displayName ?? '',
          email: user.email ?? '', topic, transcript,
        }),
      })
      if (!res.ok) throw new Error('escalate failed')
      const data = await res.json() as { twoWay: boolean; ticket?: string }
      const t = data.ticket ?? null
      setTicket(t)
      setEscalated(true)
      setStage('chat')
      threadActiveRef.current = true
      setTwoWay(data.twoWay)
      push('support', `Thanks — I've passed this to our team.${t ? ` Your ticket is ${t}.` : ''} We'll reply right here, and you can follow up any time at admin@lushnote.com.au${t ? ` quoting ${t}` : ''}. Add anything else below.`)
      if (data.twoWay) poll()
    } catch {
      // The Slack post can succeed even when the response is lost (e.g. a
      // serverless timeout). Check whether a thread actually got created before
      // alarming the doctor — if it did, the escalation worked.
      setEscalated(true)
      setStage('chat')
      try {
        await poll()
      } catch { /* ignore */ }
      if (threadActiveRef.current) {
        push('support', "Thanks — I've passed this to our team. We'll reply right here, and you can follow up any time at admin@lushnote.com.au. Add anything else below.")
      } else {
        push('support', "Sorry — I couldn't reach our team just now. Please email admin@lushnote.com.au and we'll help.")
      }
    } finally {
      setSending(false)
    }
  }, [user, profile, topic, push, poll])

  // Step 2: doctor describes the issue → AI decides if it can answer or escalate.
  const submitDescription = useCallback(async (text: string) => {
    push('user', text)
    bumpActivity()
    setAwaitingDescription(false)
    setSending(true)
    try {
      // No x-groq-key: support triage runs on LushNote's own Groq key server-side,
      // so it never spends the doctor's Groq/Gemini allowance.
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'support-triage', topic, description: text, kb: LUSHNOTE_KB }),
      })
      const data = await res.json() as { canHelp?: boolean; answer?: string }
      if (data.canHelp && data.answer?.trim()) {
        push('support', data.answer.trim())
        setYesNo(true)   // ask "did this solve it?"
      } else {
        await escalate()
      }
    } catch {
      await escalate()
    } finally {
      setSending(false)
    }
  }, [push, bumpActivity, topic, escalate])

  // Post-escalation: doctor's typed message goes to the human thread.
  const sendToHuman = useCallback(async (text: string) => {
    if (!user) return
    push('user', text)
    bumpActivity()
    setSending(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', uid: user.uid, name: profile?.displayName ?? '', email: user.email ?? '', message: text }),
      })
      const data = await res.json() as { twoWay: boolean; error?: string }
      if (data.error) throw new Error(data.error)
      setTwoWay(data.twoWay)
      if (data.twoWay) poll()
      else push('support', "Message received. We'll get back to you by email shortly.")
    } catch {
      push('support', 'Message could not be sent. Please email admin@lushnote.com.au directly.')
    } finally {
      setSending(false)
    }
  }, [user, profile, push, bumpActivity, poll])

  // End chat: close the Slack thread (fresh ticket next time) and reset to the
  // topic menu so the old conversation no longer shows.
  const endChat = useCallback(async () => {
    if (inactivityTimerRef.current) { clearTimeout(inactivityTimerRef.current); inactivityTimerRef.current = null }
    if (user) {
      try {
        await fetch('/api/support', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close', uid: user.uid }),
        })
      } catch { /* reset locally regardless */ }
    }
    setMessages([])
    messagesRef.current = []
    setStage('menu')
    setTopic('')
    setTicket(null)
    setYesNo(false)
    setEscalated(false)
    setAwaitingDescription(false)
    setInput('')
    setHasUnread(false)
    seenTsRef.current = new Set()
    primedRef.current = true
    threadActiveRef.current = false
  }, [user])
  endChatRef.current = endChat

  // Step 1: doctor taps a topic (no AI) → we ask for a description.
  const pickTopic = useCallback((t: SupportTopic) => {
    setTopic(t.label)
    setStage('chat')
    setAwaitingDescription(true)
    push('support', t.prompt)
    bumpActivity()
  }, [push, bumpActivity])

  // Step 3: yes/no after an AI answer. No → escalate to a human.
  const answerYesNo = useCallback(async (solved: boolean) => {
    setYesNo(false)
    bumpActivity()
    if (solved) {
      push('user', 'Yes, that solved it')
      push('support', 'Great — glad that sorted it! Pick a topic below any time you need us again.')
      setStage('menu')
    } else {
      push('user', "No, it didn't help")
      await escalate()
    }
  }, [bumpActivity, push, escalate])

  // The input send button — routes to the right step.
  const submitInput = useCallback(() => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    if (awaitingDescription) void submitDescription(text)
    else if (escalated) void sendToHuman(text)
    else void submitDescription(text)
  }, [input, sending, awaitingDescription, escalated, submitDescription, sendToHuman])

  // twoWay is read by poll/escalate/sendToHuman to decide whether replies come
  // back in-app or by email. Nothing renders it, so it is intentionally not
  // exposed — referenced here so the linter sees it as used.
  void twoWay

  return (
    <Ctx.Provider value={{
      messages, input, setInput, sending, stage, topic, ticket, yesNo, escalated,
      awaitingDescription, hasUnread, setPanelOpen, topics: SUPPORT_TOPICS,
      pickTopic, answerYesNo, submitInput, endChat,
    }}>
      {children}
    </Ctx.Provider>
  )
}
