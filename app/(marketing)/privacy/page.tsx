import Link from 'next/link'
import { pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block, Todo } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'Privacy Policy',
  description: 'The LushNote privacy policy for the AI clinical note builder used by doctors in Australia.',
  path: '/privacy',
})

// Headings only until the owner writes the substance. The policy doctors have
// actually agreed to is the combined document at /terms, so this points there
// rather than leaving a visitor with nothing.
export default function PrivacyPage() {
  return (
    <PageBody>
      <PageIntro
        title="Privacy Policy"
        lead={<>Our current privacy policy is part of our <Link href="/terms" className="text-[var(--blue)] underline">Terms of Service and Privacy Policy</Link>.</>}
      />
      <Block title="What we collect">
        <Todo>List the personal and clinical information LushNote collects.</Todo>
      </Block>
      <Block title="How we use it">
        <Todo>Describe how that information is used.</Todo>
      </Block>
      <Block title="Who we share it with">
        <Todo>Name the service providers that process it.</Todo>
      </Block>
      <Block title="Storage and retention">
        <Todo>State where information is stored and how long it is kept.</Todo>
      </Block>
      <Block title="Your choices and rights">
        <Todo>Describe access, correction, export and deletion.</Todo>
      </Block>
      <Block title="Contact">
        <Todo>Give the privacy contact.</Todo>
      </Block>
    </PageBody>
  )
}
