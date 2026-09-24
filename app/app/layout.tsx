import { NOINDEX } from '@/lib/noindex'

// Everything under /app is behind sign-in and holds patient data, so none of it
// belongs in a search index. robots.ts also disallows /app, but a disallow only
// stops crawling; a page linked from elsewhere can still be listed without this.
export const metadata = NOINDEX

export default function AppSegmentLayout({ children }: { children: React.ReactNode }) {
  return children
}
