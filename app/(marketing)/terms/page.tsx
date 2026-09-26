import { pageMeta } from '@/lib/site'
import TermsContent from './TermsContent'

export const metadata = pageMeta({
  title: 'Terms of Service',
  description: 'The terms of service and privacy policy for LushNote, the AI clinical note builder for doctors in Australia.',
  path: '/terms',
})

// The agreed text lives in TermsContent, unchanged. It is a client component
// only for its print button and the "ask the AI agent" link; it still renders
// in full on the server.
export default function TermsPage() {
  return <TermsContent />
}
