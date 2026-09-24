import type { Metadata } from 'next'

// The public site's one address. Canonical links, the sitemap, Open Graph and
// the Organization record all derive from it, so it must be the hostname Vercel
// serves as primary; the other one should redirect here.
export const SITE_URL = 'https://www.lushnote.com.au'
export const SITE_NAME = 'LushNote'
export const DEFAULT_TITLE = 'LushNote - AI clinical notes for psychiatrists'
export const DEFAULT_DESCRIPTION =
  'Turn psychiatric consultations into progress notes, referral letters and discharge summaries in minutes. Built in Australia. Try it free.'
export const SOCIAL_IMAGE = { url: '/icon-512.png', width: 512, height: 512, alt: 'LushNote' }

/** Only the production deployment is indexed. Vercel sets VERCEL_ENV to
 *  'preview' for every branch build; a local build has none. */
export const INDEXABLE = process.env.VERCEL_ENV === 'production'

export const CONTACT_EMAIL = 'admin@lushnote.com.au'

/** Every public page, in nav order. The sitemap is built from this list, so a
 *  page added here is also submitted to search engines. */
export const PUBLIC_PAGES = [
  { path: '/', label: 'Home', nav: false },
  { path: '/how-it-works', label: 'How it works', nav: true },
  { path: '/pricing', label: 'Pricing', nav: true },
  { path: '/security', label: 'Security', nav: true },
  { path: '/about', label: 'About', nav: true },
  { path: '/contact', label: 'Contact', nav: true },
  { path: '/privacy', label: 'Privacy', nav: false },
  { path: '/terms', label: 'Terms', nav: false },
  { path: '/login', label: 'Log in', nav: false },
] as const

/**
 * Metadata for one public page. Next merges metadata shallowly, so a page that
 * sets its own title without its own openGraph would share the home page's
 * preview card; this sets both together, plus the canonical link.
 */
export function pageMeta({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
  const shareTitle = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      title: shareTitle,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: 'en_AU',
      type: 'website',
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: 'summary',
      title: shareTitle,
      description,
      images: [SOCIAL_IMAGE.url],
    },
  }
}
