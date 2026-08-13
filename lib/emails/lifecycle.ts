import { escapeHtml } from '@/lib/utils'
import type { OutboundEmail } from '@/lib/email'

// The lifecycle emails, in the doctor's own words as drafted. Each is factual
// and about the account the doctor opened — it promotes nothing — so it is a
// service message rather than a commercial one, and reaches doctors who declined
// product news. An unsubscribe is still included: it costs nothing and removes
// the argument entirely (see CLAUDE.md, Lifecycle Emails).

export type LifecycleEmailType = 'welcome' | 'apiSetup' | 'inactive'

export const LIFECYCLE_LABEL: Record<LifecycleEmailType, string> = {
  welcome: 'Welcome',
  apiSetup: 'API setup reminder (day 7)',
  inactive: 'Inactive reminder (7 days idle)',
}

const SITE = 'https://lushnote.com.au'
const SIGN_OFF = 'The LushNote Team\nBuilt to save doctors.\nLushNote.com.au'

// "Dr. Jane Smith" → "Jane Smith". The greeting supplies its own title, and the
// stored name usually already carries one.
function bareName(displayName: string): string {
  return (displayName || '').replace(/^(dr\.?|doctor)\s+/i, '').trim()
}

function greeting(displayName: string): string {
  const n = bareName(displayName)
  return n ? `Dear Dr. ${n},` : 'Dear Doctor,'
}

// Plain text is the source of truth; the HTML part is the same words in the same
// order. Paragraphs split on a blank line, and a lone [label](url) line becomes
// the link — so editing the copy never means editing markup.
function toHtml(body: string, unsubscribeUrl: string): string {
  const paragraphs = body.split(/\n\s*\n/).map(p => {
    const withLinks = escapeHtml(p.trim())
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,
        (_m, label: string, href: string) => `<a href="${href}" style="color:#2563eb">${label}</a>`)
      .replace(/\n/g, '<br>')
    return `<p style="margin:0 0 16px">${withLinks}</p>`
  }).join('')
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;max-width:560px">
${paragraphs}
<p style="margin:24px 0 0;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px">
LushNote · admin@lushnote.com.au · <a href="${SITE}" style="color:#94a3b8">lushnote.com.au</a><br>
These are account emails about the LushNote account you opened.
<a href="${unsubscribeUrl}" style="color:#94a3b8">Unsubscribe</a>.
</p>
</div>`
}

function assemble(subject: string, body: string, unsubscribeUrl: string): OutboundEmail {
  const text = `${body}\n\n—\nLushNote · admin@lushnote.com.au · lushnote.com.au\nThese are account emails about the LushNote account you opened.\nUnsubscribe: ${unsubscribeUrl}`
  return { to: '', subject, text, html: toHtml(body, unsubscribeUrl) }
}

export function buildLifecycleEmail(
  type: LifecycleEmailType,
  displayName: string,
  unsubscribeUrl: string,
): OutboundEmail {
  const hi = greeting(displayName)

  if (type === 'welcome') {
    return assemble('Welcome to LushNote', `${hi}

You've just signed in to LushNote, and we're sending this note so you remember why you did.

There will come a day when the documentation backlog pushes you toward burnout on your ward. When that day comes, we want you to remember that you signed up for something built to pull you out of that hole.

We know you're busy, so we'll keep it straight. Most doctors around the world aren't paid anywhere near what their work is worth. On top of saving lives, they're expected to be precise with their documentation, and that takes time and can be exhausting. That's why we built LushNote, so AI can finally be used for something that matters.

That's it. We hope you have a great day.

If you have any suggestions or questions, reach out to our team at this email anytime. You can always read our policy statement [here](${SITE}/terms).

${SIGN_OFF}`, unsubscribeUrl)
  }

  if (type === 'apiSetup') {
    return assemble('Still need a hand setting up LushNote?', `${hi}

A week ago you registered for LushNote, but it looks like you never finished setting up your API key, so you haven't been able to use it yet.

Here's a link to a video on how to set up the API — [watch it here](${SITE}/setup). It's really easy and takes only 2 minutes. If you get stuck, just reply to this email or reach out to our team and we'll walk you through it.

We just don't want you to have signed up for something and never gotten the point of it.

${SIGN_OFF}`, unsubscribeUrl)
  }

  return assemble('Your LushNote account is ready when you are', `${hi}

Your API key is set up and LushNote is ready to go, but it's been a week since you last wrote a note with it.

If something got in the way — a template that didn't fit your ward, an export that wasn't quite right — just reply to this email and tell us. We would rather fix it than have you go back to typing notes by hand.

${SIGN_OFF}`, unsubscribeUrl)
}
