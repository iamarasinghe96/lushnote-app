'use client'

const EFFECTIVE_DATE = '26 June 2025'
const CONTACT_EMAIL = 'iamarasinghe96@gmail.com'

export default function TermsPage() {
  return (
    <div className="h-dvh overflow-y-auto bg-[#f8fafc] text-[#0f172a]">

      {/* Nav */}
      <nav className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-[#e2e8f0] px-4 py-3 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <img src="/icon.svg" alt="" width={32} height={32} className="w-8 h-8" aria-hidden />
          <span className="font-semibold text-[#0f172a]">LushNote</span>
        </a>
        <button
          onClick={() => window.print()}
          className="text-sm px-4 py-1.5 rounded-full border border-[#e2e8f0] text-[#475569]
                     hover:border-[#2563eb]/50 hover:text-[#2563eb] transition-colors"
        >
          Download PDF
        </button>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-12 print:py-4">

        {/* Acknowledgment */}
        <div className="mb-10 p-5 rounded-2xl border border-[#d8f0e8] bg-[#f0fdf8]">
          <p className="text-sm font-semibold text-[#059669] mb-1">Acknowledgment of Country</p>
          <p className="text-sm text-[#475569] leading-relaxed">
            LushNote acknowledges the Traditional Custodians of the lands on which we work and live,
            and pays respect to Elders past and present. We recognise the enduring strength of
            Aboriginal and Torres Strait Islander peoples and their deep connection to Country,
            culture, and community. We are committed to building healthcare tools that reduce
            the documentation burden on all clinicians — enabling more time for the people
            who need care most.
          </p>
        </div>

        <h1 className="text-3xl font-bold mb-1">Terms of Service &amp; Privacy Policy</h1>
        <p className="text-sm text-[#94a3b8] mb-10">Effective date: {EFFECTIVE_DATE}</p>

        {/* Purpose */}
        <Section title="1. Our Purpose">
          <p>
            LushNote is a clinical documentation tool built for psychiatrists and other medical
            practitioners. Our mission is to make high-quality healthcare documentation free of
            charge, reducing the administrative burden on doctors so they can spend more time
            with patients — and ultimately help save more lives.
          </p>
          <p>
            We believe protecting patient privacy is inseparable from this mission. Every
            architectural decision in LushNote has been made with privacy as the foundation,
            not an afterthought.
          </p>
        </Section>

        {/* Acceptance */}
        <Section title="2. Acceptance of These Terms">
          <p>
            By creating a LushNote account or using any part of the service, you agree to
            these Terms of Service and Privacy Policy. If you do not agree, please do not
            use LushNote.
          </p>
          <p>
            These terms are governed by the laws of Australia. LushNote operates in compliance
            with the <em>Privacy Act 1988</em> (Cth), the Australian Privacy Principles (APPs),
            and applicable state health records legislation.
          </p>
        </Section>

        {/* Who we are */}
        <Section title="3. Who We Are">
          <p>
            LushNote is an independent clinical productivity tool developed and operated by an
            individual Australian developer. We are not affiliated with any hospital, health
            network, or AI company.
          </p>
          <p>
            Contact: <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#2563eb] underline">{CONTACT_EMAIL}</a>
          </p>
        </Section>

        {/* Data we collect */}
        <Section title="4. What Data We Collect and Why">
          <SubHeading>4.1 Account Information</SubHeading>
          <p>
            When you sign in with Google, we receive your name, email address, and Google
            account identifier. This is used solely to authenticate you and link your clinical
            notes to your account. We never use this information for advertising or share it
            with third parties for marketing purposes.
          </p>

          <SubHeading>4.2 Clinical Notes and Patient Records</SubHeading>
          <p>
            Progress notes you create — including patient name, registration number, diagnosis,
            session content, and related clinical fields — are stored in your account on
            Firebase Firestore (Google Cloud, Australian/US regions). This data is encrypted
            at rest and in transit.
          </p>
          <p>
            <strong>Only you can access your patient notes.</strong> Access is enforced at the
            database level by Firestore security rules: every read and write operation is
            validated server-side to confirm the requesting user is the note's owner. No
            LushNote team member, developer, or administrator can query or view your patient
            data through any normal application pathway. There is no admin dashboard that
            surfaces clinical note content.
          </p>

          <SubHeading>4.3 Audio Recordings</SubHeading>
          <p>
            If you use voice recording or dictation features, audio is captured in your browser
            and sent directly to a transcription API (Google Gemini or Groq Whisper). <strong>Audio
            is never stored by LushNote</strong> — it exists in memory only for the duration of
            the transcription request and is discarded immediately afterwards. We do not retain,
            log, or archive any audio recordings.
          </p>

          <SubHeading>4.4 Referral Letters and Generated Documents</SubHeading>
          <p>
            When you generate a referral letter, cover letter, or other AI-drafted document,
            the content is produced in real time and delivered directly to you. <strong>Generated
            letter content is not stored by LushNote</strong> unless you explicitly save it as
            part of a note. Letters produced for the purpose of sending to third parties
            (colleagues, specialists) are not retained after your session.
          </p>

          <SubHeading>4.5 API Keys</SubHeading>
          <p>
            If you provide your own Gemini or Groq API key, it is stored encrypted in your
            Firestore profile and in browser sessionStorage. It is never logged, transmitted
            to our servers beyond Firestore, or used for any purpose other than making AI
            requests on your behalf.
          </p>

          <SubHeading>4.6 Usage Metadata</SubHeading>
          <p>
            We track a simple per-user count of daily Gemini API calls to enforce fair-use
            limits on free-tier access. This count does not include note content and resets
            daily. No other usage analytics are collected.
          </p>
        </Section>

        {/* Security */}
        <Section title="5. Security Architecture">
          <p>
            LushNote is designed so that patient data is protected by multiple independent
            layers:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li>
              <strong>Encryption at rest:</strong> All Firestore data is encrypted at rest
              by Google Cloud using AES-256 by default. We do not hold encryption keys —
              Google manages them under their Cloud Key Management Service.
            </li>
            <li>
              <strong>Encryption in transit:</strong> All communication between your browser,
              our servers, and Firebase is over HTTPS/TLS 1.2+.
            </li>
            <li>
              <strong>Server-side access rules:</strong> Firestore security rules run on
              Google's servers before any data is returned. A query for your notes will be
              rejected unless the authenticated user ID matches the owner of the requested
              records — even if someone were to obtain a valid Firebase token for a
              different account.
            </li>
            <li>
              <strong>No developer back-door:</strong> The LushNote developer does not have
              a privileged service account that can browse patient notes. Administrative
              operations (such as managing letterhead images) are scoped to non-clinical
              configuration data only. Any future administrative tooling will be documented
              here and will never include access to clinical note content.
            </li>
            <li>
              <strong>Firebase Authentication:</strong> Sign-in is delegated entirely to
              Google OAuth 2.0. LushNote never receives or stores your Google password.
            </li>
          </ul>
        </Section>

        {/* AI and Third Parties */}
        <Section title="6. AI Processing and Third-Party Services">
          <SubHeading>6.1 Does LushNote Train AI on Your Data?</SubHeading>
          <p>
            <strong>No.</strong> LushNote does not train, fine-tune, or improve any AI model
            using your clinical data or transcripts. Your data is sent to AI providers
            (Google Gemini, Groq) solely to generate a response for your immediate request.
          </p>
          <p>
            Google's API usage policy for Gemini (via Google AI Studio / Vertex AI) explicitly
            states that data submitted through the API is not used to train generative models
            by default. Groq similarly does not use API data for model training. You should
            review these providers' current policies as they may be updated independently
            of LushNote.
          </p>

          <SubHeading>6.2 Transcript Redaction</SubHeading>
          <p>
            LushNote includes an optional transcript redaction feature (Settings → Transcripts)
            that automatically strips patient names, dates of birth, phone numbers, email
            addresses, and postal addresses from transcripts before they are sent to any AI
            provider. We strongly recommend enabling this feature.
          </p>

          <SubHeading>6.3 Third-Party Services Used</SubHeading>
          <table className="w-full text-sm border border-[#e2e8f0] rounded-xl overflow-hidden mt-2">
            <thead className="bg-[#f1f5f9]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Service</th>
                <th className="text-left px-3 py-2 font-semibold">Purpose</th>
                <th className="text-left px-3 py-2 font-semibold">Data Shared</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              <tr>
                <td className="px-3 py-2">Firebase (Google Cloud)</td>
                <td className="px-3 py-2">Auth, database, file storage</td>
                <td className="px-3 py-2">Account info, clinical notes</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Google Gemini API</td>
                <td className="px-3 py-2">AI transcription &amp; generation</td>
                <td className="px-3 py-2">Session transcripts (temporary)</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Groq API</td>
                <td className="px-3 py-2">AI fallback transcription &amp; generation</td>
                <td className="px-3 py-2">Session transcripts (temporary)</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Vercel</td>
                <td className="px-3 py-2">Web hosting &amp; serverless functions</td>
                <td className="px-3 py-2">Request metadata (IP, headers)</td>
              </tr>
            </tbody>
          </table>
        </Section>

        {/* Your Rights */}
        <Section title="7. Your Rights Under Australian Privacy Law">
          <p>
            Under the <em>Privacy Act 1988</em> (Cth) and the Australian Privacy Principles,
            you have the right to:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li><strong>Access</strong> the personal information we hold about you</li>
            <li><strong>Correct</strong> inaccurate personal information</li>
            <li><strong>Delete</strong> your account and all associated data</li>
            <li><strong>Complain</strong> to the Office of the Australian Information Commissioner
              (OAIC) at <a href="https://www.oaic.gov.au" className="text-[#2563eb] underline" target="_blank" rel="noopener noreferrer">oaic.gov.au</a> if
              you believe your privacy rights have been breached</li>
            <li><strong>Withdraw consent</strong> at any time by deleting your account</li>
          </ul>
          <p>
            As a healthcare professional, you also hold independent obligations to your patients
            under the <em>Health Records Act</em> (state-specific), AHPRA registration standards,
            and any relevant clinical governance frameworks of your workplace or professional
            college (RANZCP, RACGP, etc.). LushNote is a documentation tool — your professional
            and legal obligations as a treating clinician remain your own.
          </p>
        </Section>

        {/* Account Deletion */}
        <Section title="8. Account Deletion and Data Erasure">
          <p>
            When you delete your LushNote account, the following happens <strong>immediately
            and permanently</strong> in sequence:
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-[#475569]">
            <li>You are re-authenticated via Google to confirm your identity</li>
            <li>A deletion feedback record (reasons only, no clinical data) is stored briefly for service improvement</li>
            <li>All of your progress notes in the <code className="text-xs bg-[#f1f5f9] px-1 py-0.5 rounded">progress_notes</code> collection are deleted in batches</li>
            <li>All patient profiles in your account are deleted</li>
            <li>Your user profile (name, email, API keys, settings) is deleted</li>
            <li>Your Google account is unlinked from LushNote</li>
            <li>All session keys are cleared from your browser</li>
          </ol>
          <p>
            <strong>Deletion is irreversible.</strong> We do not retain backups of deleted
            user data. Once deleted, clinical notes and patient records cannot be recovered
            by you or by LushNote.
          </p>
          <p>
            Firestore's underlying infrastructure may retain encrypted fragments in its own
            backup systems for up to 7 days per Google's standard policy, after which they
            are purged. These fragments are inaccessible to LushNote and to any third party
            without Google's encryption keys.
          </p>
        </Section>

        {/* Clinician obligations */}
        <Section title="9. Obligations of Clinicians Using LushNote">
          <p>
            By using LushNote as a healthcare professional, you acknowledge that:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li>You are responsible for the accuracy and clinical appropriateness of all notes generated or stored in LushNote</li>
            <li>AI-generated content must be reviewed and verified by you before being used in any clinical context or communicated to patients or colleagues</li>
            <li>LushNote does not replace clinical judgement and is not a medical device</li>
            <li>You are responsible for obtaining any required patient consent for recording or transcribing sessions under applicable state and territory laws</li>
            <li>You must not share your LushNote login or allow others to access your account</li>
            <li>You are responsible for keeping your own API keys confidential</li>
          </ul>
        </Section>

        {/* Data Retention */}
        <Section title="10. Data Retention">
          <p>
            Clinical notes and patient records are retained for as long as your account
            is active. You can delete individual notes at any time from the History tab,
            or delete your entire account and all associated data as described in Section 8.
          </p>
          <p>
            We do not impose a minimum retention period. There is no period after which
            data is automatically deleted — data persists until you choose to delete it
            or delete your account.
          </p>
          <p>
            Audio recordings: zero retention. They are processed in memory and discarded
            immediately after transcription.
          </p>
          <p>
            AI-generated letters and documents: not stored by LushNote unless you save them
            as part of a note. Once your browser session ends, unsaved generated content is gone.
          </p>
        </Section>

        {/* Notifiable Data Breaches */}
        <Section title="11. Data Breach Notification">
          <p>
            LushNote is subject to the Notifiable Data Breaches (NDB) scheme under Part
            IIIC of the <em>Privacy Act 1988</em> (Cth). In the event of an eligible data
            breach that is likely to result in serious harm to affected individuals, we will:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li>Notify the Office of the Australian Information Commissioner (OAIC) as soon as practicable</li>
            <li>Notify affected users directly via the email address associated with their account</li>
            <li>Provide a clear description of the breach, what data was involved, and what steps we are taking</li>
          </ul>
        </Section>

        {/* Disclaimer */}
        <Section title="12. Disclaimer and Limitation of Liability">
          <p>
            LushNote is provided &quot;as is&quot; without warranty of any kind. We make no guarantee
            that the service will be uninterrupted, error-free, or that AI-generated content
            will be clinically accurate.
          </p>
          <p>
            To the maximum extent permitted by Australian Consumer Law, LushNote is not
            liable for any loss or damage arising from reliance on AI-generated documentation,
            service outages, data loss (other than as a direct result of our own negligence),
            or any clinical decision made using LushNote.
          </p>
          <p>
            Nothing in these terms excludes statutory guarantees under the Australian Consumer
            Law (Schedule 2 of the <em>Competition and Consumer Act 2010</em> (Cth)).
          </p>
        </Section>

        {/* Changes */}
        <Section title="13. Changes to These Terms">
          <p>
            We may update these terms from time to time. When we make material changes,
            we will update the effective date at the top of this page and notify active
            users via email. Continued use of LushNote after notice of changes constitutes
            acceptance of the updated terms.
          </p>
        </Section>

        {/* FAQ */}
        <div className="mt-14">
          <h2 className="text-2xl font-bold mb-6">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <FAQ q="If I delete my account, does all my data get permanently deleted?">
              Yes — completely and immediately. Deleting your account triggers a sequence that
              removes every progress note, every patient profile, and your personal account
              record from Firebase. This is irreversible. We do not retain a copy, we cannot
              restore deleted accounts, and no LushNote team member can retrieve data after
              deletion. Google's underlying Firestore infrastructure may hold encrypted
              fragments for up to 7 days in its own backup layer before they are purged —
              these are inaccessible to anyone outside Google.
            </FAQ>

            <FAQ q="If I recorded a patient session, can someone hack LushNote and access it?">
              Audio recordings are never stored by LushNote. The moment transcription completes,
              the audio is discarded — it exists in memory only for a matter of seconds. There
              is no recording archive to breach. The resulting transcript text is stored in your
              Firestore account, protected by per-user security rules that enforce ownership at
              the database level. A breach of the LushNote application layer would not grant
              access to Firestore data, because access is controlled server-side by Google
              Cloud — not by our application code.
            </FAQ>

            <FAQ q="Does LushNote train AI on my patient data?">
              No. Your clinical notes, transcripts, and patient data are never used to train,
              fine-tune, or improve any AI model — not by LushNote, not by Google Gemini,
              and not by Groq. Data is sent to these providers only to generate a response
              for your immediate request. Google's API terms explicitly exclude API data from
              model training by default.
            </FAQ>

            <FAQ q="Who can see my patient notes?">
              Only you. Access to progress notes is enforced by Firestore security rules that
              run on Google's servers: every request is checked against the authenticated user
              ID before any data is returned. The LushNote developer does not have a back-door,
              admin dashboard, or privileged service account that can read clinical note
              content. Administrative functions (e.g., letterhead images) are scoped
              exclusively to non-clinical configuration data.
            </FAQ>

            <FAQ q="Where is my data stored?">
              Your data is stored in Google Firebase Firestore, which uses Google Cloud
              infrastructure. Google operates data centres in multiple regions including
              Australia (Sydney). All data is encrypted at rest (AES-256) and in transit
              (TLS 1.2+). LushNote does not operate its own database servers.
            </FAQ>

            <FAQ q="What happens to audio recordings of sessions?">
              Audio never leaves your browser as a stored file. It is streamed or submitted
              directly to a transcription API (Gemini or Groq), a text transcript is returned,
              and the audio is immediately discarded. LushNote has no audio storage, no
              recording archive, and no mechanism to replay or retrieve a session recording
              after transcription.
            </FAQ>

            <FAQ q="Is LushNote compliant with Australian privacy law?">
              LushNote is designed to comply with the Privacy Act 1988 (Cth) and the
              Australian Privacy Principles. We collect only information necessary to
              provide the service, store it securely, give you full control over deletion,
              and do not share it for marketing or advertising. As a clinician, you also
              hold independent obligations under state health records legislation and
              AHPRA standards — LushNote supports these but does not replace them.
            </FAQ>

            <FAQ q="Can the developer access my patient data?">
              No. The LushNote developer does not have a privileged admin account or
              back-door that can access clinical note content. Firestore security rules
              are enforced by Google's servers before any data is returned — they cannot
              be bypassed by anyone, including the developer, without obtaining a
              patient-user's own authentication credentials. Any future administrative
              tooling will be explicitly documented here and will never be scoped to
              clinical data.
            </FAQ>

            <FAQ q="What patient information does LushNote need to function?">
              LushNote stores only the fields you enter: patient name, registration number,
              date, time, diagnosis, and clinical note sections. It does not collect Medicare
              numbers, addresses, photographs, billing details, or any information beyond what
              you type into the note fields. You control what goes in; you can delete it at
              any time.
            </FAQ>

            <FAQ q="I am a patient. How can I request deletion of my records?">
              LushNote stores patient records under the account of the treating clinician.
              Patient data can only be deleted by the clinician who created it, or when that
              clinician deletes their LushNote account. If you are a patient seeking access
              to or deletion of your records, please contact your treating doctor directly.
              For concerns about how your information has been handled, you may also contact
              the OAIC at oaic.gov.au.
            </FAQ>
          </div>
        </div>

        {/* Contact */}
        <div className="mt-14 pt-8 border-t border-[#e2e8f0]">
          <p className="text-sm text-[#475569]">
            Questions about these terms or a privacy concern?
            Email <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#2563eb] underline">{CONTACT_EMAIL}</a>.
            We aim to respond within 5 business days.
          </p>
          <p className="text-xs text-[#94a3b8] mt-3">
            LushNote — Built to save one more life. &copy; 2025
          </p>
        </div>

      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-[#0f172a] mb-3 pb-2 border-b border-[#e2e8f0]">{title}</h2>
      <div className="space-y-3 text-[#475569] leading-relaxed text-sm">
        {children}
      </div>
    </section>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="font-semibold text-[#0f172a] mt-4 mb-1">{children}</p>
}

function FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
      <p className="font-semibold text-[#0f172a] text-sm mb-2">{q}</p>
      <p className="text-sm text-[#475569] leading-relaxed">{children}</p>
    </div>
  )
}
