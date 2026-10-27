// The roadmap the admin console starts from, loaded once with "Use the starter
// roadmap" when the list is empty. After that it is ordinary data: edit, add,
// remove. Written from the owner's priorities of October 2026.
//
// Product names from the research stay out of this file: the repository is
// public. The research itself is summarised in docs/ROADMAP.md.

export interface StarterItem {
  /** Stable, so "add suggested items" can tell which are already there. */
  key: string
  title: string
  theme: string
  notes: string
  steps: string[]
  /** Assigned to the owner when the owner loads it. */
  ownerItem?: boolean
}

export const STARTER: StarterItem[] = [
  {
    key: 'staging',
    title: 'Finish the separate staging database',
    theme: 'Platform and reliability',
    notes: 'Staging still shares the live database until the console setup is done. Steps are in STAGING_DATABASE_SETUP.md.',
    steps: [
      'Create the staging Firebase project (Blaze plan, budget alert)',
      'Firestore: same location as live, publish rules, add the progress_notes index',
      'Storage and Authentication (Google, Email/Password, staging domain)',
      'Vercel: Preview-only values for the nine Firebase variables',
      'Make the owner admin on staging, provision the test account, update GitHub secrets',
      'Releases page shows "separate from live"',
      'Turn on daily backups for the live database',
    ],
  },
  {
    key: 'lifecycle-emails',
    title: 'Lifecycle emails: onboarding to offboarding',
    theme: 'Onboarding, trial and emails',
    notes: 'One designed set of emails for the whole journey, built with React Email so they share one look and can be previewed. Today there are a few plain lifecycle emails (lib/emails, Admin → Emails).\n\nWhat a well-run 14-day trial in the research sent, in order: day 0 a personal welcome from the founder (why the product exists) with a short setup checklist; day 3 the checklist again as four concrete steps; day 7 the next things to connect; day 10 an AI feature spotlight; the day before the end, reassurance that their data carries over, what paid adds, and "need more time? your data is kept safe". On cancelling: access continues to the end of the billing period, data is kept for a stated number of days with a reminder to download it, and a one-click way back; a second email asks for feedback and names what they did not try. Every trial email says how many days are left, and has one clear button.\n\nLushNote\'s trial is three months, so the cadence stretches to fit it.',
    steps: [
      'Move email templates to React Email, with a preview in Admin → Emails',
      'Welcome, personally from the founder: why LushNote exists (day 0)',
      'Setup checklist in four steps: letterhead, signature, a template, first note (day 0, nudge on day 3 if unfinished)',
      'Next things to try once set up: letters from notes, hospital forms, dictation',
      'AI feature spotlight, with days left on the trial',
      'Trial ending soon: notes carry over, what continues on paid, more time if needed',
      'Trial ended without subscribing: what happens to their data, one click to come back',
      'Decide how long a closed account\'s data is kept, and put it in the privacy policy',
      'Cancelled: access until the end of the billing period, data kept for N days, download now, reactivate',
      'After leaving: one-question feedback, and what they did not get to try',
      'Every email: founder voice, one clear button, unsubscribe respected',
    ],
  },
  {
    key: 'paid-ai',
    title: 'LushNote-paid AI for everyone; retire bring-your-own key',
    theme: 'Onboarding, trial and emails',
    notes: 'Asking a new doctor for an AI key is the hardest step in onboarding. Move everyone onto LushNote\'s paid Gemini key so signup is: sign in, set up, start. Fair use and Enterprise already exist for the heavy end.',
    steps: [
      'Cost model: AI cost per doctor per month against the subscription',
      'Route every subscribed or trialling doctor to the paid key',
      'Remove the API key step from onboarding',
      'Keep own keys only for Enterprise, out of the main path',
      'Retire the "set up your API key" email',
      'Update pricing, terms and Settings copy',
    ],
  },
  {
    key: 'segments',
    title: 'An interface for each kind of user',
    theme: 'Interface and experience',
    notes: 'Intern doctors, psychiatrists and clinics need different things. Pick the features from the research backlog (docs/ROADMAP.md) that matter to each, and design LushNote\'s own way of doing them rather than copying.',
    steps: [
      'Define the segments and what each needs most',
      'Ask the segment in onboarding, change it later in Settings',
      'Interns: ward round speed, handovers, hospital forms',
      'Psychiatrists: sessions, letters, risk and MSE structure',
      'Clinics: shared templates and letterheads, team accounts, an admin',
      'Map backlog items to segments, choose the first three to build',
      'Prototype one segment end to end on staging',
    ],
  },
  {
    key: 'smoothness',
    title: 'Smoothness: make every screen feel fast',
    theme: 'Platform and reliability',
    notes: 'Doctors use LushNote between patients. Anything that stalls, flickers or loses their place costs trust.',
    steps: [
      'Measure: page load and interaction times on a mid-range phone',
      'List the five slowest moments a doctor hits daily',
      'Loading states that never jump or flash',
      'Poor network and offline: nothing lost, clear status',
      'Clear the browser console of warnings',
      'Mobile pass on every main screen',
    ],
  },
  {
    key: 'marketing',
    title: 'Marketing: clinics and social media',
    theme: 'Marketing and growth',
    notes: 'Owned by the founder.',
    ownerItem: true,
    steps: [
      'List of clinics to reach, and an outreach message',
      'Regular posts and reels',
      'Testimonials from doctors already using LushNote',
      'Landing page updates to match the campaigns',
    ],
  },
  {
    key: 'encryption',
    title: 'End-to-end encryption',
    theme: 'Security and sign-in',
    notes: 'Decide what "end-to-end" can honestly mean for LushNote: the AI has to read the words to write the note, so a strict scheme where only the doctor holds the key changes what is possible. Start with a written threat model and options, then build.',
    steps: [
      'Threat model: who we protect against, and where data is readable today',
      'Options and their cost to features (AI, search, sharing)',
      'Encrypt stored notes and patient records with a per-doctor key',
      'Key recovery a doctor can actually use',
      'Update the security page and privacy policy to match exactly',
    ],
  },
  {
    key: 'sign-in',
    title: 'Safer sign-in: more than one way in',
    theme: 'Security and sign-in',
    notes: 'Google only today. Add work email (Microsoft), email codes, and phone with SMS one-time codes, plus two-factor. SMS has a cost per message; check it before turning it on for everyone.',
    steps: [
      'Email sign-in with a one-time code or link',
      'Microsoft sign-in for work and hospital email addresses',
      'Phone number with SMS one-time code (cost per message checked first)',
      'Two-factor authentication',
      'Link methods to existing Google accounts, so nobody gets a second account',
      'Test every method on staging first',
    ],
  },
  {
    key: 'data-import-export',
    title: 'Import and export a doctor\'s data',
    theme: 'Privacy and data',
    notes: 'A doctor should be able to bring their records in from another system and take everything out again, whenever they like and for a set time after they leave. Today export is one note at a time (PDF or Word). Backlog: PRV-17, PRV-18, PRV-19, PRV-20, LEG-26, SEC-11, DOC-17.',
    steps: [
      'Export everything: notes, letters, forms and patients, by date range, as PDF and CSV (PRV-17)',
      'Confirm identity again before a full export (SEC-11)',
      'Every export recorded in an audit log the doctor can see (PRV-20)',
      'Letters export to Word, like notes already do (DOC-17)',
      'Export window after cancelling, then deletion, stated in the terms (PRV-19, LEG-26)',
      'Import patients from a CSV file, with a preview before anything is saved (PRV-18)',
      'Import notes from another system, assisted for the first clinics (PRV-18)',
    ],
  },
]
