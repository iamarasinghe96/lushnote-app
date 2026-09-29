import Link from 'next/link'
import { CONTACT_EMAIL, pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'Privacy Policy',
  description: 'The LushNote privacy policy for the AI clinical note builder used by doctors in Australia.',
  path: '/privacy',
})

// A plain summary of the combined Terms of Service and Privacy Policy, which is
// what doctors agree to and which governs if the two ever differ. Every
// statement here is either in that document or enforced in code.
const LIST = 'list-disc pl-5 space-y-1.5'
const LINK = 'text-[var(--blue)] underline'

export default function PrivacyPage() {
  return (
    <PageBody>
      <PageIntro
        title="Privacy Policy"
        lead={<>A plain summary of how LushNote handles personal and clinical information. The full, binding version is our <Link href="/terms" className={LINK}>Terms of Service and Privacy Policy</Link>.</>}
      />

      <Block title="What we collect">
        <ul className={LIST}>
          <li><strong>Your account:</strong> your name, email address and a unique account identifier from Google sign-in, plus the professional and workplace details you add.</li>
          <li><strong>Clinical content:</strong> the notes, letters, forms, patient records and transcripts you create.</li>
          <li><strong>Session audio:</strong> when you record, each few minutes of audio is kept as a backup so a session is not lost if transcription fails.</li>
          <li><strong>AI keys:</strong> any Gemini or Groq key you choose to save.</li>
          <li><strong>Usage records:</strong> monthly counts of AI requests and our estimate of their cost. Never the content of a request.</li>
          <li><strong>Billing:</strong> your subscription status. Card and bank details are held by our payment processor, never by LushNote.</li>
        </ul>
      </Block>

      <Block title="How we use it">
        <p>
          To run LushNote for you: to sign you in, to turn your consultations into notes and letters, to keep your records
          in your account, and to bill your subscription. Usage records help us run and pay for the service and apply the
          fair-use allowance. We never use your information for advertising, and your notes, transcripts and patient
          information are never used to train or improve any AI model.
        </p>
      </Block>

      <Block title="Who we share it with">
        <p>Only the services LushNote runs on, and only for the job each one does:</p>
        <ul className={LIST}>
          <li><strong>Google Cloud (Firebase):</strong> stores your account, clinical content and audio backups.</li>
          <li><strong>Google Gemini and Groq:</strong> transcribe audio and write notes, one request at a time.</li>
          <li><strong>Vercel:</strong> hosts the website.</li>
          <li><strong>Stripe:</strong> processes payments.</li>
          <li><strong>Zoho:</strong> sends account emails, such as trial reminders.</li>
          <li><strong>Slack:</strong> delivers the messages you send to Live Support to our team.</li>
          <li><strong>Geoapify:</strong> looks up a letter recipient&apos;s address from the name you type.</li>
        </ul>
        <p>We do not sell your information, and no LushNote team member or administrator can view your clinical notes.</p>
      </Block>

      <Block title="Storage and retention">
        <ul className={LIST}>
          <li>Notes, letters and patient records stay in your account until you delete them or delete your account. There are no automatic deletion timelines for records you keep.</li>
          <li>Session audio backups are kept until you delete your account.</li>
          <li>Operational logs record errors and counts, never clinical content.</li>
          <li>Invoice, transaction and GST records must be kept for five years, so they remain after an account is deleted.</li>
          <li>If you tell us why you are leaving when you delete your account, that feedback is kept.</li>
        </ul>
      </Block>

      <Block title="Your choices and rights">
        <ul className={LIST}>
          <li><strong>Access:</strong> everything you have written is in the app, and you can ask us for the personal information we hold about you.</li>
          <li><strong>Correction:</strong> edit any note, record or profile detail at any time.</li>
          <li><strong>Export:</strong> download any note or letter as a PDF, copy it, or send it by email.</li>
          <li><strong>Deletion:</strong> delete any note or letter, or <Link href="/app/settings?tab=profile" className={LINK}>delete your account</Link> and everything in it.</li>
          <li><strong>Redaction:</strong> choose what is removed from transcripts in <Link href="/app/settings?tab=transcripts" className={LINK}>Settings, Transcripts</Link>.</li>
          <li><strong>Emails:</strong> every account email has a one-click unsubscribe link.</li>
        </ul>
        <p>
          Patients: your records are held under your treating clinician&apos;s account, so please ask your clinician for
          access or deletion.
        </p>
      </Block>

      <Block title="Contact">
        <p>
          For any privacy question or request, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>{CONTACT_EMAIL}</a>. We aim to respond within 5 business
          days. If you are not satisfied with our response, you can complain to the Office of the Australian Information
          Commissioner at{' '}
          <a href="https://www.oaic.gov.au" className={LINK} target="_blank" rel="noopener noreferrer">oaic.gov.au</a>.
        </p>
      </Block>
    </PageBody>
  )
}
