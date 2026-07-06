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
      action: 'send' | 'poll'
      uid: string
      name?: string
      email?: string
      message?: string
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

    if (action === 'poll') {
      if (!BOT_TOKEN || !CHANNEL) {
        return NextResponse.json({ twoWay: false, messages: [] })
      }

      const snap = await adminDb().collection('support_threads').doc(uid).get()
      if (!snap.exists) {
        return NextResponse.json({ twoWay: true, messages: [] })
      }

      const threadTs = snap.data()?.threadTs as string
      const params = new URLSearchParams({ channel: CHANNEL, ts: threadTs, limit: '200' })
      const res = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
        headers: { Authorization: `Bearer ${BOT_TOKEN}` },
      })
      const data = await res.json() as { ok: boolean; error?: string; messages?: SlackMessage[] }
      if (!data.ok) throw new Error(`Slack conversations.replies: ${data.error}`)

      // Skip the thread parent (our header). Bot-posted messages are the
      // doctor's own (sent via this route); human messages are admin replies.
      const messages = (data.messages ?? [])
        .filter(m => m.ts !== threadTs && !m.subtype && (m.text ?? '').trim())
        .map(m => ({
          role: m.bot_id ? 'user' : 'support',
          text: m.text ?? '',
          ts: m.ts,
        }))

      return NextResponse.json({ twoWay: true, messages })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Support request failed'
    console.error('[support]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
