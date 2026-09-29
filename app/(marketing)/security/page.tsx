import Link from 'next/link'
import { CONTACT_EMAIL, pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'Security',
  description: 'How LushNote looks after the clinical information that doctors and their patients trust it with.',
  path: '/security',
})

// Every statement here is either in the Terms doctors agree to or is enforced in
// code (firestore.rules, storage.rules, the admin API). No region, certification
// or retention period is claimed that nothing in the product backs.
const LIST = 'list-disc pl-5 space-y-1.5'

export default function SecurityPage() {
  return (
    <PageBody>
      <PageIntro
        title="Security"
        lead="LushNote holds clinical notes, so it is built on the assumption that everything in it is sensitive."
      />

      <Block title="How clinical information is protected">
        <ul className={LIST}>
          <li>All data is encrypted in transit between your device and our servers, and encrypted at rest where it is stored.</li>
          <li>Each note, patient record, transcript and draft belongs to one account. Access rules enforced on the server, not only in the app, stop any other account from reading or changing them.</li>
          <li>When you record a session, each few minutes of audio is saved as a backup so the session is not lost if transcription fails. No account can play back or download that backup, including yours, and it is deleted with your account.</li>
          <li>Your signature and any letterhead images you upload can be read only by your account.</li>
          <li>Card and bank details are entered straight into our payment processor, Stripe, and never reach LushNote.</li>
        </ul>
      </Block>

      <Block title="Where data is stored">
        <p>
          Your account, notes, patient records and audio backups are stored on Google Cloud, through Firebase.
          The website is hosted by Vercel. LushNote does not run its own database servers.
        </p>
      </Block>

      <Block title="Who can access it">
        <ul className={LIST}>
          <li>Sign-in is handled entirely by Google. LushNote never receives or stores your password.</li>
          <li>Only you can see your notes and patient records. There is no admin view of clinical content.</li>
          <li>LushNote administrators can see account details, subscription status, and monthly counts of AI requests with an estimate of their cost. They cannot see what your notes say.</li>
          <li>Messages you send to Live Support go to the LushNote team, so please keep patient details out of them.</li>
        </ul>
      </Block>

      <Block title="AI providers">
        <p>
          Transcription and note writing use Google Gemini, with Groq as a fallback. Data is sent to them only to produce
          the response you asked for, while that request is being processed, and it is never used to train or improve any
          AI model.
        </p>
        <p>
          Transcript redaction, on by default in{' '}
          <Link href="/app/settings?tab=transcripts" className="text-[var(--blue)] underline">Settings, Transcripts</Link>,
          removes dates of birth, phone numbers, email addresses, street addresses and titled names (such as &ldquo;Dr
          Smith&rdquo;) from a transcript before it is sent to write your note, and instructs the AI to leave any other
          names out of the note it writes.
        </p>
      </Block>

      <Block title="Reporting a security concern">
        <p>
          If you think you have found a vulnerability, or that your account or data has been exposed, email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--blue)] underline">{CONTACT_EMAIL}</a>. Please include
          what you saw and when, but no patient information.
        </p>
        <p>
          If a data breach occurs that could cause serious harm, we will notify the Office of the Australian Information
          Commissioner and everyone affected as quickly as possible, under the Notifiable Data Breaches scheme.
        </p>
      </Block>
    </PageBody>
  )
}
