import { pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block, Todo } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'Security',
  description: 'How LushNote looks after the clinical information that doctors and their patients trust it with.',
  path: '/security',
})

// Headings only until the owner writes the substance. Nothing here may state
// where data is stored, how long it is kept, or any certification.
export default function SecurityPage() {
  return (
    <PageBody>
      <PageIntro title="Security" />
      <Block title="How clinical information is protected">
        <Todo>Describe how notes and recordings are protected in transit and at rest.</Todo>
      </Block>
      <Block title="Where data is stored">
        <Todo>State where data is stored and processed.</Todo>
      </Block>
      <Block title="Who can access it">
        <Todo>Describe account access, and who at LushNote can and cannot see clinical content.</Todo>
      </Block>
      <Block title="AI providers">
        <Todo>Describe what is sent to AI providers and on what terms.</Todo>
      </Block>
      <Block title="Reporting a security concern">
        <Todo>Say how to report a vulnerability or a suspected breach.</Todo>
      </Block>
    </PageBody>
  )
}
