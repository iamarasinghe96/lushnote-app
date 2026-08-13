import nodemailer, { type Transporter } from 'nodemailer'

// Outbound mail through the Zoho mailbox the app already owns, rather than a
// separate sending service. Both lifecycle emails ask the doctor to reply, and
// sending as the real mailbox means those replies land in it — a transactional
// API would send from an address nobody reads.
//
// Env (all server-side):
//   ZOHO_SMTP_HOST  smtp.zoho.com.au   (.com for a US-region account)
//   ZOHO_SMTP_USER  admin@lushnote.com.au
//   ZOHO_SMTP_PASS  an app-specific password, NOT the account password
//   EMAIL_FROM      "LushNote <admin@lushnote.com.au>"
//   EMAIL_REPLY_TO  optional, defaults to the from address

let cached: Transporter | null = null

export function emailConfigured(): boolean {
  return !!(process.env.ZOHO_SMTP_USER && process.env.ZOHO_SMTP_PASS)
}

function transport(): Transporter {
  if (cached) return cached
  cached = nodemailer.createTransport({
    host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com.au',
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_SMTP_USER,
      pass: process.env.ZOHO_SMTP_PASS,
    },
  })
  return cached
}

export interface OutboundEmail {
  to: string
  subject: string
  text: string
  html: string
}

// Resolves to null on success, or a short reason on failure. Never throws: one
// doctor's bounced address must not abort a batch of thirty.
export async function sendEmail(mail: OutboundEmail): Promise<string | null> {
  if (!emailConfigured()) return 'email not configured'
  try {
    await transport().sendMail({
      from: process.env.EMAIL_FROM || 'LushNote <admin@lushnote.com.au>',
      replyTo: process.env.EMAIL_REPLY_TO || process.env.ZOHO_SMTP_USER,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return null
  } catch (err) {
    return (err instanceof Error ? err.message : 'send failed').slice(0, 300)
  }
}
