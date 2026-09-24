import Link from 'next/link'
import { PUBLIC_PAGES, CONTACT_EMAIL } from '@/lib/site'
import { HeaderAuth } from './HeaderAuth'

// Server-rendered, so every public page arrives with its navigation in the
// HTML. The only client piece is HeaderAuth, which swaps "Log in" for "Open
// LushNote" once Firebase says who is here.

const NAV = PUBLIC_PAGES.filter(p => p.nav)

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 bg-white/95 border-b border-[var(--border)] print:hidden">
      <div className="max-w-5xl mx-auto h-14 px-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <img src="/icon.svg" alt="" width={32} height={32} className="w-8 h-8" aria-hidden />
          <span className="font-semibold text-[var(--text)]">LushNote</span>
        </Link>

        <nav aria-label="Main" className="hidden md:flex items-center gap-5 text-sm text-[var(--text2)]">
          {NAV.map(p => (
            <Link key={p.path} href={p.path} className="hover:text-[var(--text)] motion-safe:transition-colors">{p.label}</Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <HeaderAuth />
          {/* A <details> menu needs no JavaScript, so the links are in the HTML a
              crawler reads. Plain anchors, not Link: a client-side navigation
              would keep this layout mounted and leave the menu hanging open. */}
          <details className="md:hidden relative">
            <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer px-3 py-1.5 rounded-full border border-[var(--border)] text-sm text-[var(--text2)]">
              Menu
            </summary>
            <nav aria-label="Main" className="absolute right-0 mt-2 w-48 rounded-[var(--r-lg)] border border-[var(--border)] bg-white shadow-lg py-2">
              {NAV.map(p => (
                <a key={p.path} href={p.path} className="block px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg)]">{p.label}</a>
              ))}
              <a href="/login" className="block px-4 py-2 mt-1 border-t border-[var(--border)] text-sm font-medium text-[var(--blue)] hover:bg-[var(--bg)]">Log in</a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--border)] py-8 px-4 print:hidden">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-[var(--text3)]">&copy; {new Date().getFullYear()} LushNote. Built in Australia.</p>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[var(--text2)]">
          <Link href="/privacy" className="hover:text-[var(--text)]">Privacy</Link>
          <Link href="/terms" className="hover:text-[var(--text)]">Terms</Link>
          <Link href="/security" className="hover:text-[var(--text)]">Security</Link>
          <Link href="/contact" className="hover:text-[var(--text)]">Contact</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-[var(--text)]">{CONTACT_EMAIL}</a>
        </nav>
      </div>
    </footer>
  )
}
