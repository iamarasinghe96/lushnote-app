'use client'

const EFFECTIVE_DATE = '26 June 2025'
const CONTACT_EMAIL = 'iamarasinghe96@gmail.com'

export default function TermsPage() {
  return (
    <div className="h-dvh overflow-y-auto print:h-auto print:overflow-visible bg-[#f8fafc] text-[#0f172a]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>

      {/* Nav */}
      <nav className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-[#e2e8f0] px-4 py-3 flex items-center justify-between print:hidden">
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
          <p className="text-sm text-[#475569] leading-relaxed text-justify">
            LushNote acknowledges the Traditional Custodians of the lands on which we work and live,
            and pays respect to Elders past and present. We are committed to building healthcare
            tools that reduce the documentation burden on all clinicians, freeing up more time
            for the patients who need care most.
          </p>
        </div>

        <h1 className="text-3xl font-bold mb-1">Terms of Service and Privacy Policy</h1>
        <p className="text-sm text-[#94a3b8] mb-10">Effective date: {EFFECTIVE_DATE}</p>

        <Section title="1. Our Purpose">
          <p>
            LushNote is a clinical documentation tool built for psychiatrists and other doctors.
            Our goal is to reduce the time spent on paperwork so clinicians can focus on their
            patients.
          </p>
          <p>
            Protecting patient privacy is central to everything we do. Every decision about how
            LushNote works has been made with privacy as the starting point.
          </p>
        </Section>

        <Section title="2. Accepting These Terms">
          <p>
            By creating a LushNote account, you agree to these Terms of Service and Privacy
            Policy. If you do not agree, please do not use LushNote.
          </p>
          <p>
            These terms are governed by Australian law. LushNote is designed to comply with
            the Privacy Act 1988 (Cth) and the Australian Privacy Principles.
          </p>
        </Section>

        <Section title="3. Who We Are">
          <p>
            LushNote is an independent tool developed by an individual Australian developer.
            We are not affiliated with any hospital, health network, or AI company.
          </p>
          <p>
            Questions or concerns? Reach us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#2563eb] underline">{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <Section title="4. What Data We Collect">
          <SubHeading>Your account</SubHeading>
          <p>
            When you sign in with Google, we receive your name, email address, and a unique
            account identifier. This is only used to log you in and link your notes to your account.
            We never use your account information for advertising.
          </p>

          <SubHeading>Your clinical notes</SubHeading>
          <p>
            Notes you create, including patient details and session content, are stored securely
            in your account. Only you can access your own notes. No LushNote team member or
            administrator can view your patient data.
          </p>

          <SubHeading>Audio recordings</SubHeading>
          <p>
            If you record a session or dictate a note, the audio is sent directly for
            transcription and then immediately discarded. Audio is never stored by LushNote.
            There is no recording archive.
          </p>

          <SubHeading>Letters and generated documents</SubHeading>
          <p>
            When you generate a letter (such as a referral, a records request, or a custom
            letter), it is saved securely to your account in the same way as your clinical
            notes, so you can find it later under the relevant patient and re-open, edit, or
            export it. Like your notes, saved letters can only be accessed by you, and no
            LushNote team member or administrator can view them. You can delete any saved
            letter at any time. The underlying audio, if you dictated the letter, is still
            never stored — it is transcribed and immediately discarded.
          </p>

          <SubHeading>API keys</SubHeading>
          <p>
            If you provide your own Gemini or Groq API key, it is stored securely in your
            account and is never shared or used for any purpose other than making AI requests
            on your behalf.
          </p>
        </Section>

        <Section title="5. How We Protect Your Data">
          <p>
            Your data is protected in several straightforward ways:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li>All data is encrypted while stored and while being transmitted between your device and our servers.</li>
            <li>Your notes can only be accessed by you. This is enforced at the server level, not just in the application.</li>
            <li>No developer or administrator at LushNote has access to your clinical notes. There is no admin view of patient data.</li>
            <li>Sign-in is handled entirely by Google. LushNote never receives or stores your password.</li>
          </ul>
        </Section>

        <Section title="6. AI and Third-Party Services">
          <SubHeading>Does LushNote train AI on your data?</SubHeading>
          <p>
            No. Your notes, transcripts, and patient information are never used to train or
            improve any AI model. Data is sent to AI providers only to generate a response
            for your immediate request, and only while that request is being processed.
          </p>

          <SubHeading>Transcript redaction</SubHeading>
          <p>
            LushNote includes an optional redaction feature (Settings, Transcripts) that
            automatically removes patient names, dates of birth, phone numbers, and other
            identifiers from transcripts before they are sent to any AI provider. We recommend
            enabling this feature.
          </p>

          <SubHeading>Services we use</SubHeading>
          <table className="w-full text-sm border border-[#e2e8f0] rounded-xl overflow-hidden mt-2">
            <thead className="bg-[#f1f5f9]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Service</th>
                <th className="text-left px-3 py-2 font-semibold">What it does</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e2e8f0]">
              <tr>
                <td className="px-3 py-2">Firebase (Google Cloud)</td>
                <td className="px-3 py-2">Stores your account and clinical notes securely</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Google Gemini</td>
                <td className="px-3 py-2">Transcribes audio and generates notes (request only)</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Groq</td>
                <td className="px-3 py-2">Fallback transcription and note generation (request only)</td>
              </tr>
              <tr>
                <td className="px-3 py-2">Vercel</td>
                <td className="px-3 py-2">Hosts the LushNote website</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="7. Your Rights">
          <p>
            Under the Australian Privacy Act 1988 and the Australian Privacy Principles, you have
            the right to:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li>Access the personal information we hold about you</li>
            <li>Correct any inaccurate information</li>
            <li>Delete your account and all associated data at any time</li>
            <li>Lodge a complaint with the Office of the Australian Information Commissioner at{' '}
              <a href="https://www.oaic.gov.au" className="text-[#2563eb] underline" target="_blank" rel="noopener noreferrer">oaic.gov.au</a>{' '}
              if you believe your privacy has been mishandled</li>
          </ul>
          <p>
            As a registered clinician, you also hold your own professional obligations under
            AHPRA and your professional college (RANZCP, RACGP, etc.). LushNote is a
            documentation tool and does not replace those obligations.
          </p>
        </Section>

        <Section title="8. Deleting Your Account">
          <p>
            When you delete your LushNote account, all of your data is permanently removed.
            This includes every clinical note, every patient profile, and your personal
            account details. The steps happen in this order:
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-[#475569]">
            <li>You confirm your identity via Google sign-in</li>
            <li>All of your clinical notes are deleted</li>
            <li>All patient profiles in your account are deleted</li>
            <li>Your account profile is deleted</li>
            <li>Your Google account is disconnected from LushNote</li>
          </ol>
          <p>
            Deletion is permanent and cannot be undone. We do not keep backups of deleted
            accounts. Once deleted, your data cannot be recovered by you or by LushNote.
          </p>
        </Section>

        <Section title="9. Your Responsibilities as a Clinician">
          <p>
            By using LushNote, you confirm that you:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[#475569]">
            <li>Will review and verify all AI-generated content before using it clinically or sharing it with patients or colleagues</li>
            <li>Understand that LushNote is a documentation aid and does not replace clinical judgement</li>
            <li>Have obtained any consent required by law before recording or transcribing a patient session</li>
            <li>Will keep your LushNote account and API keys confidential and will not share access with others</li>
          </ul>
        </Section>

        <Section title="10. How Long We Keep Your Data">
          <p>
            Your notes stay in your account for as long as your account is active. You can
            delete individual notes at any time from the History tab, or delete everything
            by deleting your account.
          </p>
          <p>
            Audio recordings are not stored at all. Letters you generate are saved to your
            account alongside your notes and kept for as long as your account is active; you
            can delete any letter at any time. There are no automatic deletion timelines for
            notes or letters you choose to keep.
          </p>
        </Section>

        <Section title="11. Data Breach Notification">
          <p>
            If a data breach occurs that could cause serious harm, we will notify both the
            Office of the Australian Information Commissioner and any affected users as
            quickly as possible, in line with the Notifiable Data Breaches scheme under the
            Privacy Act 1988 (Cth).
          </p>
        </Section>

        <Section title="12. Disclaimer">
          <p>
            LushNote is provided as-is. While we work hard to keep the service reliable and
            accurate, we cannot guarantee that AI-generated notes will always be clinically
            correct. You are responsible for reviewing all output before using it.
          </p>
          <p>
            To the extent permitted by Australian Consumer Law, LushNote is not liable for
            any loss arising from reliance on AI-generated content or from service outages.
            Your statutory rights under the Australian Consumer Law are not affected.
          </p>
        </Section>

        <Section title="13. Changes to These Terms">
          <p>
            If we make significant changes to these terms, we will update the date at the top
            of this page and notify active users by email. Continuing to use LushNote after
            being notified of changes means you accept the updated terms.
          </p>
        </Section>

        {/* FAQ */}
        <div className="mt-14">
          <h2 className="text-2xl font-bold mb-6">Common Questions</h2>
          <div className="space-y-4">
            <FAQ q="If I delete my account, does all my data get deleted?">
              Yes, everything is deleted permanently. Every note, every patient profile, and
              your personal account details are removed immediately. This cannot be undone,
              and we cannot recover deleted data.
            </FAQ>

            <FAQ q="If I recorded a patient session, can someone hack LushNote and get to it?">
              Audio is never stored. It exists only for the few seconds it takes to transcribe,
              then it is gone. There is no recording archive that could be accessed. Your written
              notes are stored securely and can only be accessed by your account.
            </FAQ>

            <FAQ q="Does LushNote train AI on my patient data?">
              No. Your data is never used to train or improve any AI model. It is only sent to
              the AI provider in the moment you generate a note, purely to produce that response.
            </FAQ>

            <FAQ q="Who can see my patient notes?">
              Only you. No LushNote developer or administrator has access to your clinical notes.
              There is no internal dashboard where staff can view patient data.
            </FAQ>

            <FAQ q="Where is my data stored?">
              Your notes are stored on Google Cloud (Firebase), which uses secure data centres
              and encrypts all data at rest and in transit. LushNote does not run its own
              database servers.
            </FAQ>

            <FAQ q="What happens to the audio after a session recording?">
              The audio is transcribed immediately and then discarded. It is never saved to a
              file, never uploaded to storage, and cannot be retrieved or replayed after
              transcription is complete.
            </FAQ>

            <FAQ q="Is LushNote compliant with Australian privacy law?">
              Yes. LushNote is designed to comply with the Privacy Act 1988 (Cth) and the
              Australian Privacy Principles. As a clinician, you also hold your own obligations
              under state health records laws and AHPRA standards, which LushNote supports but
              does not replace.
            </FAQ>

            <FAQ q="Can the developer access my patient data?">
              No. There is no back-door, no admin account, and no internal tool that gives
              anyone at LushNote access to clinical note content. Your notes are protected
              at the server level, not just by the application.
            </FAQ>

            <FAQ q="What patient information does LushNote store?">
              Only what you type into the note fields: patient name, registration number, date,
              diagnosis, session notes, and so on. LushNote does not collect Medicare numbers,
              home addresses, photos, or billing details.
            </FAQ>

            <FAQ q="I am a patient. How do I request my records?">
              Patient records are stored under the account of the treating doctor. Please contact
              your clinician directly to request access to or deletion of your records. If you
              have a privacy concern, you can also contact the OAIC at oaic.gov.au.
            </FAQ>
          </div>
        </div>

        {/* Contact */}
        <div className="mt-14 pt-8 border-t border-[#e2e8f0]">
          <p className="text-sm text-[#475569]">
            Any questions about these terms or a privacy concern? Email us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#2563eb] underline">{CONTACT_EMAIL}</a>.
            We aim to respond within 5 business days.
          </p>
          <p className="text-xs text-[#94a3b8] mt-3">
            LushNote. Built to save one more life. &copy; 2025
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
      <div className="space-y-3 text-[#475569] leading-relaxed text-sm text-justify">
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
      <p className="text-sm text-[#475569] leading-relaxed text-justify">{children}</p>
    </div>
  )
}
