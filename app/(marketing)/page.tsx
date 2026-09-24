import Link from 'next/link'
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL, pageMeta } from '@/lib/site'
import { PLAN_PRICE_AUD } from '@/lib/fairUse'
import { PRIMARY_CTA_LARGE, SECONDARY_CTA } from '@/components/marketing/Page'

export const metadata = pageMeta({ description: DEFAULT_DESCRIPTION, path: '/' })

const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  sameAs: [] as string[],
}

// The brand gradient from the previous landing page, kept to the hero.
const HERO_BG = [
  'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(90,214,167,0.75) 0%, transparent 60%)',
  'radial-gradient(ellipse 60% 45% at 95% 20%, rgba(37,99,235,0.45) 0%, transparent 55%)',
  'radial-gradient(ellipse 55% 40% at 0% 10%, rgba(37,99,235,0.30) 0%, transparent 55%)',
  '#e6f5ef',
].join(', ')

const DOCUMENTS = [
  {
    title: 'Progress notes',
    body: 'Record the session, dictate afterwards, or paste a transcript. LushNote structures it into a complete note using your template.',
  },
  {
    title: 'GP referral letters',
    body: 'Turn the same consult into a letter for the GP or a colleague, ready to download as a PDF or send by email.',
  },
  {
    title: 'Discharge summaries',
    body: 'Draft the summary from the consult instead of starting from a blank page, then review and edit it before it goes anywhere.',
  },
]

const STEPS = [
  { title: 'Capture', body: 'Record a session, dictate a note, or paste a transcript.' },
  { title: 'Transcribe', body: 'Audio is transcribed in moments.' },
  { title: 'Draft', body: 'Choose a template and the AI structures the document.' },
  { title: 'Review and export', body: 'Edit, then download a PDF, copy it, or send it by email.' },
]

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION) }} />

      <section className="px-4 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center" style={{ background: HERO_BG }}>
        <div className="max-w-3xl mx-auto space-y-6">
          <p className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-white/70 text-[var(--blue)]">
            AI clinical notes, built in Australia
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold text-[var(--text)] leading-tight">
            Psychiatrist with a documentation backlog?
          </h1>
          <p className="text-lg sm:text-xl text-[var(--text2)] leading-relaxed">
            Progress notes, GP referral letters and discharge summaries, drafted from your consult in minutes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link href="/login" className={PRIMARY_CTA_LARGE}>Start your free trial</Link>
            <Link href="/how-it-works" className={SECONDARY_CTA}>See how it works</Link>
          </div>
          <p className="text-sm text-[var(--text2)]">
            Then A${PLAN_PRICE_AUD}/month. <Link href="/pricing" className="underline underline-offset-2">See pricing</Link>
          </p>
        </div>
      </section>

      <section className="px-4 py-16 sm:py-20">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-[var(--text)] mb-10">
            The paperwork after the consult, drafted for you
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {DOCUMENTS.map(d => (
              <div key={d.title} className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-5">
                <h3 className="font-semibold text-[var(--text)] mb-2">{d.title}</h3>
                <p className="text-sm text-[var(--text2)] leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:py-20 bg-white border-y border-[var(--border)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-[var(--text)] mb-10">From consult to finished document</h2>
          <ol className="grid gap-8 sm:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col items-center text-center gap-2">
                <span className="w-10 h-10 rounded-full bg-[var(--blue-lt)] text-[var(--blue)] flex items-center justify-center text-sm font-bold">
                  {i + 1}
                </span>
                <h3 className="font-semibold text-[var(--text)] text-sm">{s.title}</h3>
                <p className="text-sm text-[var(--text2)] leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="text-center mt-10">
            <Link href="/how-it-works" className="text-[var(--blue)] font-medium underline underline-offset-2">More on how it works</Link>
          </p>
        </div>
      </section>

      <section className="px-4 py-16 sm:py-20">
        <div className="max-w-xl mx-auto text-center space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--text)]">Clear the backlog, not your evenings.</h2>
          <p className="text-[var(--text2)]">Try LushNote free, with every feature included.</p>
          <Link href="/login" className={PRIMARY_CTA_LARGE}>Start your free trial</Link>
        </div>
      </section>
    </>
  )
}
