import Link from 'next/link'
import { pageMeta } from '@/lib/site'
import { PLAN_PRICE_AUD } from '@/lib/fairUse'
import { PageBody, PageIntro, Block, Todo, PRIMARY_CTA_LARGE } from '@/components/marketing/Page'

// The amount comes from the same constant billing charges and fair use is
// measured against, so this page cannot quote a different price.
const PRICE = `A$${PLAN_PRICE_AUD}/month`

export const metadata = pageMeta({
  title: 'Pricing',
  description: `LushNote is ${PRICE} with every feature included and a free trial to start. See what the subscription covers, and Enterprise for practices.`,
  path: '/pricing',
})

export default function PricingPage() {
  return (
    <PageBody>
      <PageIntro title="Pricing" lead="One plan, every feature included." />

      <div className="rounded-[var(--r-lg)] border-2 border-[#10b981]/40 bg-white p-6 sm:p-8 mb-10 space-y-4">
        <p className="text-sm font-semibold text-[#059669]">LushNote</p>
        <p className="text-4xl font-bold text-[var(--text)]">{PRICE}</p>
        <p className="text-[var(--text2)] leading-relaxed">
          Every feature included. Cancel anytime and keep access to the end of the period you&apos;ve paid for. Your
          notes are always yours to export.
        </p>
        <Block title="Free trial">
          <Todo>State the free-trial allowance: how long it lasts and what it includes.</Todo>
        </Block>
        <Link href="/login" className={PRIMARY_CTA_LARGE}>Start your free trial</Link>
      </div>

      <Block title="What the subscription covers">
        <p>
          AI is included. During the trial it runs on your own free Gemini or Groq key; once you subscribe,
          LushNote&apos;s keys cover it, up to a monthly fair-use allowance set at what the subscription pays for. One
          clinician rarely comes near it. Past it, the AI runs on your own key until the next month.
        </p>
      </Block>

      <Block title="Enterprise">
        <p>
          For practices and heavy use: {PRICE} plus your own AI usage. The AI runs on your organisation&apos;s own
          Gemini API key and Google bills you directly for what you use, at Google&apos;s rates. No fair-use allowance.
        </p>
      </Block>

      <p className="text-sm text-[var(--text3)]">
        Full details are in our <Link href="/terms" className="underline">Terms of Service and Privacy Policy</Link>.
      </p>
    </PageBody>
  )
}
