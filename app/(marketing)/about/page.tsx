import { pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block, Todo } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'About',
  description: 'LushNote is an Australian AI documentation tool for doctors, built to give clinicians back the time that paperwork takes.',
  path: '/about',
})

export default function AboutPage() {
  return (
    <PageBody>
      <PageIntro
        title="About LushNote"
        lead="LushNote is a clinical documentation tool built in Australia for doctors. It turns a consultation into the paperwork that follows it, so more of the day goes to patients."
      />
      <Block title="Why we built it">
        <Todo>Who is behind LushNote, and why it was built.</Todo>
      </Block>
      <div className="p-5 rounded-[var(--r-lg)] border border-[#d8f0e8] bg-[#f0fdf8]">
        <h2 className="text-sm font-semibold text-[#059669] mb-1">Acknowledgment of Country</h2>
        <p className="text-sm text-[var(--text2)] leading-relaxed">
          LushNote acknowledges the Traditional Custodians of the lands on which we work and live, and pays respect to
          Elders past and present. We are committed to building healthcare tools that reduce the documentation burden on
          all clinicians, freeing up more time for the patients who need care most.
        </p>
      </div>
    </PageBody>
  )
}
