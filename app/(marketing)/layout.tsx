import { SiteHeader, SiteFooter } from '@/components/marketing/SiteChrome'
import { SignedInBar } from '@/components/marketing/SignedInBar'

// The public site. Nothing here checks auth or waits for it: every page is
// server-rendered with its content in the HTML, because that HTML is what a
// search engine indexes. No analytics or third-party scripts, here or in /app.
//
// html and body do not scroll (globals.css pins them for the app shell), so
// this container is the scroller, as the old landing page's was.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="h-dvh overflow-y-auto bg-[#f8fafc] text-[var(--text)] print:h-auto print:overflow-visible"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <SignedInBar />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  )
}
