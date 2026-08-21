import { escapeHtml } from '@/lib/utils'
import type { OutboundEmail } from '@/lib/email'

// The lifecycle emails. All three are factual messages about the account the
// doctor opened — they promote nothing — so they are service messages rather
// than commercial ones and reach doctors who declined product news. An
// unsubscribe is included anyway (see CLAUDE.md, Lifecycle Emails).
//
// The copy below is only the DEFAULT. An admin can rewrite subject and body in
// the console; a saved draft wins, and Reset restores these.

export type LifecycleEmailType =
  | 'signupAbandoned' | 'welcome' | 'apiSetup'
  | 'paymentSetup7d' | 'paymentSetupDue' | 'paywalled'

export const LIFECYCLE_TYPES: LifecycleEmailType[] = ['welcome', 'signupAbandoned', 'apiSetup', 'paymentSetup7d', 'paymentSetupDue', 'paywalled']

export const LIFECYCLE_LABEL: Record<LifecycleEmailType, string> = {
  signupAbandoned: 'Signup not finished (day 3)',
  welcome: 'Welcome (at signup)',
  apiSetup: 'API not set up (day 3)',
  paymentSetup7d: 'Trial ends in a week',
  paymentSetupDue: 'Trial ends today',
  paywalled: 'Access paused',
}

export const LIFECYCLE_WHEN: Record<LifecycleEmailType, string> = {
  signupAbandoned: '3 days after a doctor first signs in, if they never finished onboarding. They get nothing else until they do.',
  welcome: 'Immediately when a doctor finishes signing up.',
  apiSetup: '3 days after finishing signup, if no Gemini or Groq key has been saved.',
  paymentSetup7d: '7 days before the free trial ends, if no payment method has been added.',
  paymentSetupDue: 'On the day the free trial ends, if no payment method has been added. A 7-day grace window follows.',
  paywalled: 'When the grace window runs out and note creation is paused. Stripe sends its own emails about failed payments — this one is only about access changing.',
}

export interface EmailTemplate {
  subject: string
  body: string
}

const SITE = 'https://lushnote.com.au'
const SIGN_OFF = 'The LushNote Team\nBuilt to save doctors.\nLushNote.com.au'

// Everything the body may reference. Shown in the editor so an admin knows what
// is available without reading the code.
export const PLACEHOLDERS = ['{{greeting}}', '{{name}}', '{{site}}', '{{trialEnd}}', '{{price}}'] as const

export const DEFAULT_TEMPLATES: Record<LifecycleEmailType, EmailTemplate> = {
  signupAbandoned: {
    subject: 'You started signing up for LushNote',
    body: `{{greeting}}

You started setting up LushNote a few days ago and didn't finish, so your account isn't ready to use yet.

Whatever you already filled in is still there — [pick up where you left off]({{site}}/onboarding) and you'll land on the step you stopped at. There isn't much after it: your name, where you work, and an API key. About two minutes.

If something in the setup didn't make sense, or you've changed your mind, just reply to this email and tell us which. Either one is useful for us to know.

${SIGN_OFF}`,
  },

  welcome: {
    subject: 'Welcome to LushNote',
    body: `{{greeting}}

You've just signed in to LushNote, and we're sending this note so you remember why you did.

There will come a day when the documentation backlog pushes you toward burnout on your ward. When that day comes, we want you to remember that you signed up for something built to pull you out of that hole.

We know you're busy, so we'll keep it straight. Most doctors around the world aren't paid anywhere near what their work is worth. On top of saving lives, they're expected to be precise with their documentation, and that takes time and can be exhausting. That's why we built LushNote, so AI can finally be used for something that matters.

That's it. We hope you have a great day.

If you have any suggestions or questions, reach out to our team at this email anytime. You can always read our policy statement [here]({{site}}/terms).

${SIGN_OFF}`,
  },

  apiSetup: {
    subject: 'Still need a hand setting up LushNote?',
    body: `{{greeting}}

You registered for LushNote a few days ago, but it looks like you never finished setting up your API key, so you haven't been able to use it yet.

Here's a link to a video on how to set up the API — [watch it here]({{site}}/setup). It's really easy and takes only 2 minutes. If you get stuck, just reply to this email or reach out to our team and we'll walk you through it.

We just don't want you to have signed up for something and never gotten the point of it.

${SIGN_OFF}`,
  },

  paymentSetup7d: {
    subject: 'Your LushNote free trial ends in a week',
    body: `{{greeting}}

Your free trial of LushNote ends on {{trialEnd}} — a week from now. We would rather tell you early than have it stop on you in the middle of a ward round.

To keep going, add your payment details here: [set up billing]({{site}}/billing). It is {{price}}, billed monthly, and you can cancel anytime.

Card payments work anywhere in the world. If you are in Australia, you can use direct debit from your bank account instead.

If LushNote has not earned its place, do nothing. Nothing will be charged, and your notes remain yours either way — you can export them from the History tab at any time.

If the price does not work for you, just reply to this email. We would rather hear from you than lose you quietly.

${SIGN_OFF}`,
  },

  paymentSetupDue: {
    subject: 'Your LushNote free trial ends today',
    body: `{{greeting}}

Your free trial of LushNote ends today. Nothing stops right now — you have a further seven days to add your payment details before note creation pauses.

Add them here: [set up billing]({{site}}/billing). It is {{price}}, billed monthly, cancel anytime.

If you would rather stop, do nothing. Nothing will be charged, and everything you have written stays yours — History and export keep working whatever you decide.

${SIGN_OFF}`,
  },

  paywalled: {
    subject: 'Your LushNote access is paused',
    body: `{{greeting}}

Your trial and the grace period after it have both ended, so creating and editing notes is paused for now.

Everything you have written is safe. History, your patient list and export all still work — your clinical records are never locked away.

To start again, add your payment details here: [set up billing]({{site}}/billing). It is {{price}}, and access comes back immediately.

If something about the price or the timing is the problem, reply to this email and tell us. We would rather sort it out than have you leave over it.

${SIGN_OFF}`,
  },
}

// "Dr. Jane Smith" → "Jane Smith". The greeting supplies its own title, and the
// stored name usually already carries one.
function bareName(displayName: string): string {
  return (displayName || '').replace(/^(dr\.?|doctor)\s+/i, '').trim()
}

export interface RenderContext {
  displayName: string
  unsubscribeUrl: string
  trialEnd?: string
  /** From priceString() — one source, so the site and the emails cannot disagree. */
  price?: string
}

function fill(text: string, ctx: RenderContext): string {
  const name = bareName(ctx.displayName)
  return text
    .replace(/\{\{greeting\}\}/g, name ? `Dear Dr. ${name},` : 'Dear Doctor,')
    .replace(/\{\{name\}\}/g, name || 'Doctor')
    .replace(/\{\{site\}\}/g, SITE)
    .replace(/\{\{trialEnd\}\}/g, ctx.trialEnd ?? 'your renewal date')
    .replace(/\{\{price\}\}/g, ctx.price ?? 'AUD $30/month')
}

// Plain text is the source of truth; the HTML part is the same words in the same
// order. Paragraphs split on a blank line, and [label](url) becomes the link — so
// editing the copy never means editing markup.
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

// Strip the markdown link syntax for the plain-text part, keeping the URL.
function plain(body: string): string {
  return body.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2')
}

export function renderLifecycleEmail(template: EmailTemplate, ctx: RenderContext): OutboundEmail {
  const body = fill(template.body, ctx)
  const footer = `\n\n—\nLushNote · admin@lushnote.com.au · lushnote.com.au\nThese are account emails about the LushNote account you opened.\nUnsubscribe: ${ctx.unsubscribeUrl}`
  return {
    to: '',
    subject: fill(template.subject, ctx),
    text: plain(body) + footer,
    html: toHtml(body, ctx.unsubscribeUrl),
  }
}
