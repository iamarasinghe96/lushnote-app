import Link from 'next/link'
import { pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block, PRIMARY_CTA_LARGE } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'How it works',
  description:
    'Record, dictate or paste a psychiatric consult and LushNote drafts the note or letter from it with your template. Review, then export as PDF or email.',
  path: '/how-it-works',
})

const STEPS = [
  { title: 'Capture the consult', body: 'Record a session, dictate a note, or paste a transcript.' },
  { title: 'Transcribe', body: 'Audio is transcribed using Gemini or Groq.' },
  { title: 'Draft', body: 'Choose a template and the AI structures a complete clinical note or letter.' },
  { title: 'Review and export', body: 'Edit anything you like, then download as PDF, copy to the clipboard, or send by email.' },
]

const MODES = [
  { title: 'Paste a transcript', body: 'Paste a transcript and LushNote structures it into a complete clinical note.' },
  { title: 'Dictate a note', body: 'Speak your note and get an AI-structured version of your dictation.' },
  { title: 'Record a session', body: 'Record in-person or telehealth sessions directly in the browser.' },
  { title: 'Create a document', body: 'Paste or upload a text document and generate a structured note from it.' },
  { title: 'Upload a recording', body: 'Upload an audio file for transcription and note generation. Coming soon.' },
]

const FEATURES = [
  { title: '116 clinical templates', body: 'Progress notes, assessments, therapy notes, and risk and safety.' },
  { title: 'Custom templates', body: 'Write your own AI instructions, tailored to your documentation style.' },
  { title: 'Multiple workplaces', body: 'Switch between clinics with one tap, each with its own letterhead and colour.' },
  { title: 'PDF and email export', body: 'Download A4 PDFs or send to colleagues with a pre-written cover note.' },
]

export default function HowItWorksPage() {
  return (
    <PageBody>
      <PageIntro
        title="How LushNote works"
        lead="LushNote turns a psychiatric consultation into the documents that follow it. You stay in charge of every word."
      />

      <Block title="From consult to finished document">
        <ol className="space-y-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="w-8 h-8 shrink-0 rounded-full bg-[var(--blue-lt)] text-[var(--blue)] flex items-center justify-center text-sm font-bold">
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold text-[var(--text)]">{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Block>

      <Block title="Ways to start a note">
        <ul className="grid gap-3 sm:grid-cols-2">
          {MODES.map(m => (
            <li key={m.title} className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4">
              <h3 className="font-semibold text-[var(--text)] text-sm mb-1">{m.title}</h3>
              <p className="text-sm">{m.body}</p>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Built around how you document">
        <ul className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map(f => (
            <li key={f.title} className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-4">
              <h3 className="font-semibold text-[var(--text)] text-sm mb-1">{f.title}</h3>
              <p className="text-sm">{f.body}</p>
            </li>
          ))}
        </ul>
      </Block>

      <div className="text-center pt-4">
        <Link href="/login" className={PRIMARY_CTA_LARGE}>Start your free trial</Link>
      </div>
    </PageBody>
  )
}
