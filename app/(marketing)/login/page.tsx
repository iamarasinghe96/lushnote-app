import Link from 'next/link'
import { pageMeta } from '@/lib/site'
import { SignInPanel } from '@/components/marketing/SignInPanel'

export const metadata = pageMeta({
  title: 'Log in',
  description: 'Log in to LushNote, or create an account to start your free trial of the AI clinical note builder for doctors.',
  path: '/login',
})

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto px-4 py-16 sm:py-24">
      <div className="rounded-[var(--r-lg)] border border-[var(--border)] bg-white p-6 sm:p-8 space-y-5">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" width={36} height={36} aria-hidden />
          <span className="text-lg font-semibold text-[var(--text)]">LushNote</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Log in to LushNote</h1>
          <p className="mt-2 text-sm text-[var(--text2)] leading-relaxed">
            New here? Continue with Google to create your account and start your free trial.
          </p>
        </div>
        <SignInPanel />
        <p className="text-xs text-[var(--text3)]">
          See our <Link href="/terms" className="underline">Terms of Service and Privacy Policy</Link>.
        </p>
      </div>
    </div>
  )
}
