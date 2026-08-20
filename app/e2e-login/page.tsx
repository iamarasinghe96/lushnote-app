import { notFound } from 'next/navigation'
import E2eLoginForm from './E2eLoginForm'

// The automated suite's way in.
//
// Real sign-in is a Google popup, which a headless browser cannot drive. The
// alternative — injecting a token into the SDK's IndexedDB — would depend on
// Firebase internals and would skip the very path the smoke suite exists to
// check: onAuthStateChanged, then the profile load, then the app shell. So the
// suite signs in for real, with email and password, against a dedicated
// non-admin fixture account.
//
// NEXT_PUBLIC_E2E is set on Vercel's Preview environment only. Without it this
// is a 404 and no form is sent to the browser at all — not a hidden page, an
// absent one. The password never lives in the app; the CI job types it in.

export default function E2eLoginPage() {
  if (process.env.NEXT_PUBLIC_E2E !== '1') notFound()
  return <E2eLoginForm />
}
