'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Keeps a tab or section selection and the address bar saying the same thing.
 *
 * Both Settings and the admin console READ their parameter on mount and never
 * write it again, so the URL froze at whatever was first opened: land on
 * `?tab=subscription`, click Profile, and the address bar still says
 * subscription. Copying that link sends someone to the wrong panel, refreshing
 * jumps away from the one being read, and a bookmark records a tab nobody was
 * looking at.
 *
 * `replaceState`, not `pushState`. The back button keeps meaning "leave this
 * page", which is what it means today; pushing an entry per tab would mean
 * pressing back nine times to get out of Settings. The panels are one screen
 * with a switcher, not nine screens.
 *
 * Next's own `router.replace` would re-run the route for what is a purely
 * client-side selection. The native History API is supported from Next 14.1 and
 * `useSearchParams` tracks it, so the read effect below stays correct either
 * way: it sets the value the caller has already set, and React drops the
 * identical update.
 */
/**
 * The URL rewrite, as a pure function so it can be tested without a browser.
 *
 * `drop` exists for the admin console: `?q=` is a filter aimed at one panel, so
 * switching section has to remove it rather than leave a stale filter that a
 * refresh re-applies somewhere it was never meant for.
 *
 * Everything else in the query survives. Rebuilding the search string from
 * scratch here is the easy way to silently lose a parameter somebody added.
 */
export function withParam(href: string, param: string, value: string, drop: string[] = []): string {
  const url = new URL(href)
  url.searchParams.set(param, value)
  for (const d of drop) url.searchParams.delete(d)
  return url.toString()
}

export function useUrlTab<T extends string>(
  param: string,
  isValid: (v: string) => v is T,
  initial: T,
): [T, (next: T) => void] {
  const searchParams = useSearchParams()
  const [value, setValue] = useState<T>(initial)

  // Held in a ref so a caller passing an inline arrow cannot make the effect
  // below re-run on every render. The validator is a predicate over a fixed
  // list; its identity is never the thing that should trigger a re-read.
  const validRef = useRef(isValid)
  validRef.current = isValid

  // URL to state: first load, a pasted link, and the back button out of a
  // deep-linked entry.
  useEffect(() => {
    const raw = searchParams.get(param)
    if (raw && validRef.current(raw)) setValue(raw)
  }, [searchParams, param])

  // State to URL. Other parameters are preserved: the admin console carries
  // `?q=` alongside `?section=`, and rebuilding the query from scratch here
  // would drop it.
  const select = useCallback((next: T) => {
    setValue(next)
    if (typeof window === 'undefined') return
    window.history.replaceState(null, '', withParam(window.location.href, param, next))
  }, [param])

  return [value, select]
}
