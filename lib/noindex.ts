import type { Metadata } from 'next'

/** For pages that exist but are not the public site: the app, the admin console,
 *  one-off landing points from emails, and the test sign-in. */
export const NOINDEX: Metadata = { robots: { index: false, follow: false } }
