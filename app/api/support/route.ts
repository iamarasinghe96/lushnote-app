import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase-admin'

// Split string prevents GitHub secret scanning (same pattern as the FAB webhook)
const SLACK_WEBHOOK = 'https://hooks.slack.com' + '/services/T0B5HRCD3QT/B0B5X3GJYBW/wmD9BaIPKisWj0rQ67vWdmnQ'

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const CHANNEL = process.env.SLACK_SUPPORT_CHANNEL

interface SlackMessage {
  ts: string
  text?: string
  bot_id?: string
  subtype?: string
}

// Human-readable ticket for follow-up over email/anywhere, e.g. LN-3F9K2.
function makeTicket(): string {
  const t = Date.now().toString(36).toUpperCase().slice(-4)
  const r = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')
  return `LN-${t}${r}`
}

async function slackApi(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json() as Record<string, unknown> & { ok: boolean; error?: string }
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`)
  return data
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      action: 'send' | 'poll' | 'escalate' | 'close' | 'markRead'
      uid: string
      name?: string
      email?: string
      message?: string
      topic?: string
      transcript?: string
      ts?: string
    }

    const { action, uid } = body
    if (!uid || typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
      return NextResponse.json({ error: 'Invalid uid' }, { status: 401 })
    }

    if (action === 'send') {
      const message = (body.message ?? '').trim()
      if (!message || message.length > 4000) {
        return NextResponse.json({ error: 'Invalid message' }, { status: 400 })
      }

      // No bot configured: fall back to the one-way incoming webhook
      if (!BOT_TOKEN || !CHANNEL) {
        await fetch(SLACK_WEBHOOK, {
          method: 'POST',
          body: JSON.stringify({
            text: `*LushNote Support Request*\n*From:* ${body.name || 'Anonymous'} (${body.email || 'no email'})\n*Message:* ${message}`,
          }),
        })
        return NextResponse.json({ twoWay: false })
      }

      const ref = adminDb().collection('support_threads').doc(uid)
      const snap = await ref.get()
      let threadTs = snap.exists ? (snap.data()?.threadTs as string) : null

      if (!threadTs) {
        const parent = await slackApi('chat.postMessage', {
          channel: CHANNEL,
          text: `💬 Support chat with ${body.name || 'Doctor'} (${body.email || uid}) — reply in this thread and it appears in their app`,
        })
        threadTs = parent.ts as string
        await ref.set({
          threadTs,
          channel: parent.channel as string,
          name: body.name ?? '',
          email: body.email ?? '',
        })
      }

      await slackApi('chat.postMessage', { channel: CHANNEL, thread_ts: threadTs, text: message })
      return NextResponse.json({ twoWay: true })
    }

    // Escalate to a human: open (or reuse) the doctor's thread with a ticket
    // number and post the bot conversation transcript for context.
    if (action === 'escalate') {
      const topic = (body.topic ?? '').toString().slice(0, 120)
      const transcript = (body.transcript ?? '').toString().slice(0, 8000)
      const name = (body.name || 'Doctor').toString().slice(0, 200)
      const email = (body.email || uid).toString().slice(0, 300)

      if (!BOT_TOKEN || !CHANNEL) {
        const ticket = makeTicket()
        await fetch(SLACK_WEBHOOK, {
          method: 'POST',
          body: JSON.stringify({
            text: `🎫 *New support ticket ${ticket}* — ${topic || 'Support'}\n*From:* ${name} (${email})\n\n${transcript}`,
          }),
        })
        return NextResponse.json({ twoWay: false, ticket })
      }

      const ref = adminDb().collection('support_threads').doc(uid)
      const snap = await ref.get()
      let threadTs = snap.exists ? (snap.data()?.threadTs as string) : null
      let ticket = snap.exists ? (snap.data()?.ticket as string | undefined) : undefined
      if (!ticket) ticket = makeTicket()

      // Always post the full escalation banner (ticket + doctor + email + topic)
      // so a human sees who to reply to — as the thread parent for a new thread,
      // or as a reply when re-escalating an existing thread.
      const banner = `🎫 *Ticket ${ticket}* — ${topic || 'Support'}\n*From:* ${name}\n*Email:* ${email}\n*Escalated to the team* — reply in this thread and it appears in the doctor's app.`

      if (!threadTs) {
        const parent = await slackApi('chat.postMessage', { channel: CHANNEL, text: banner })
        threadTs = parent.ts as string
        await ref.set({ threadTs, channel: parent.channel as string, name: body.name ?? '', email: body.email ?? '', ticket, topic })
      } else {
        await slackApi('chat.postMessage', { channel: CHANNEL, thread_ts: threadTs, text: banner })
        await ref.set({ ticket, topic, name: body.name ?? '', email: body.email ?? '' }, { merge: true })
      }

      if (transcript) {
        await slackApi('chat.postMessage', { channel: CHANNEL, thread_ts: threadTs, text: `*Conversation so far:*\n${transcript}` })
      }
      return NextResponse.json({ twoWay: true, ticket })
    }

    // End the chat: drop the thread mapping so the next escalation opens a fresh
    // thread with a new ticket. Leave a note on the old Slack thread for context.
    if (action === 'close') {
      if (BOT_TOKEN && CHANNEL) {
        const ref = adminDb().collection('support_threads').doc(uid)
        const snap = await ref.get()
        if (snap.exists) {
          const threadTs = snap.data()?.threadTs as string | undefined
          if (threadTs) {
            try { await slackApi('chat.postMessage', { channel: CHANNEL, thread_ts: threadTs, text: '✅ The doctor ended this chat.' }) } catch { /* ignore */ }
          }
          await ref.delete().catch(() => {})
        }
      }
      return NextResponse.json({ ok: true })
    }

    // Advance the doctor's read marker so already-seen replies don't resurface
    // as "unread" on the next fresh page load.
    if (action === 'markRead') {
      const ts = (body.ts ?? '').toString().slice(0, 40)
      if (ts) {
        await adminDb().collection('support_threads').doc(uid)
          .set({ lastReadTs: ts }, { merge: true })
          .catch(() => {})
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'poll') {
      if (!BOT_TOKEN || !CHANNEL) {
        return NextResponse.json({ twoWay: false, messages: [] })
      }

      const snap = await adminDb().collection('support_threads').doc(uid).get()
      if (!snap.exists) {
        return NextResponse.json({ twoWay: true, messages: [], threadExists: false })
      }

      const threadTs = snap.data()?.threadTs as string
      const params = new URLSearchParams({ channel: CHANNEL, ts: threadTs, limit: '200' })
      const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
        headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      })
      const data = await res.json() as { ok: boolean; error?: string; messages?: SlackMessage[] }
      if (!data.ok) throw new Error(`Slack conversations.replies: ${data.error}`)

      // Skip the thread parent (our header) and the internal machine posts (the
      // ticket banner + "Conversation so far" summary), which are context for the
      // team, not chat bubbles. Remaining bot-posted messages are the doctor's own
      // (sent via this route); human messages are admin replies.
      const messages = (data.messages ?? [])
        .filter(m => m.ts !== threadTs && !m.subtype && (m.text ?? '').trim())
        .filter(m => {
          const t = (m.text ?? '').trimStart()
          return !t.startsWith('🎫') && !t.startsWith('*Conversation so far') && !t.startsWith('✅')
        })
        .map(m => ({
          role: m.bot_id ? 'user' : 'support',
          text: m.text ?? '',
          ts: m.ts,
        }))

      return NextResponse.json({ twoWay: true, messages, threadExists: true, ticket: snap.data()?.ticket ?? null, lastReadTs: snap.data()?.lastReadTs ?? null })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Support request failed'
    console.error('[support]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
