import Link from 'next/link'
import { CONTACT_EMAIL, pageMeta } from '@/lib/site'
import { PageBody, PageIntro, Block } from '@/components/marketing/Page'

export const metadata = pageMeta({
  title: 'Contact',
  description: 'Get in touch with the LushNote team about the clinical note builder, your account, or a subscription for your practice.',
  path: '/contact',
})

export default function ContactPage() {
  return (
    <PageBody>
      <PageIntro title="Contact" lead="Questions about LushNote, your account, or a practice subscription? We would like to hear from you." />
      <Block title="Email">
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--blue)] font-medium underline">{CONTACT_EMAIL}</a>
        </p>
        <p>We aim to respond within 5 business days.</p>
      </Block>
      <Block title="Already using LushNote?">
        <p>
          Live Support is inside the app, under{' '}
          <Link href="/app/settings?tab=support" className="text-[var(--blue)] underline">Settings, Live Support</Link>.
        </p>
      </Block>
    </PageBody>
  )
}
