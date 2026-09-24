import type { MetadataRoute } from 'next'
import { INDEXABLE, SITE_URL } from '@/lib/site'

// The signed-in app, the API, and the pages only reachable from an email or a
// test run are not for search. A preview deployment is not for search at all.
export default function robots(): MetadataRoute.Robots {
  if (!INDEXABLE) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/app', '/api', '/admin', '/e2e-login', '/unsubscribe', '/account-deleted'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
