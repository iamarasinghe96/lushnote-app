import { describe, it, expect } from 'vitest'
import { withParam } from '@/hooks/useUrlTab'

// Settings and the admin console both READ their parameter on mount and never
// wrote it again, so the URL froze at whatever was first opened: land on
// ?tab=subscription, click Profile, and the address bar still said subscription.
// A copied link then sent someone to the wrong panel and a refresh jumped away
// from the one being read.
//
// The hook itself needs a browser, so it is not tested here. This is the part
// that carries the actual decisions: which parameter changes, which survive,
// and which are deliberately thrown away.

describe('withParam', () => {
  it('sets the parameter when it was not there', () => {
    expect(withParam('https://lushnote.com.au/settings', 'tab', 'profile'))
      .toBe('https://lushnote.com.au/settings?tab=profile')
  })

  it('replaces the parameter rather than appending a second one', () => {
    const out = withParam('https://lushnote.com.au/settings?tab=subscription', 'tab', 'profile')
    expect(out).toBe('https://lushnote.com.au/settings?tab=profile')
    expect(out).not.toContain('subscription')
  })

  // The reason this is a helper at all. Rebuilding the query from scratch is
  // the easy way to silently drop something another feature put there.
  it('leaves every other parameter alone', () => {
    const out = withParam('https://lushnote.com.au/admin?section=logs&q=abc123&keep=1', 'section', 'billing')
    const params = new URL(out).searchParams
    expect(params.get('section')).toBe('billing')
    expect(params.get('q')).toBe('abc123')
    expect(params.get('keep')).toBe('1')
  })

  // ?q= is a filter aimed at ONE panel (Users hands a uid to Logs). Carried
  // across to Billing it becomes a stale filter that a refresh re-applies to a
  // section it was never meant for.
  it('drops the parameters it is told to drop', () => {
    const out = withParam('https://lushnote.com.au/admin?section=logs&q=abc123', 'section', 'billing', ['q'])
    expect(out).toBe('https://lushnote.com.au/admin?section=billing')
  })

  it('does not mind being asked to drop something that is absent', () => {
    const out = withParam('https://lushnote.com.au/admin?section=logs', 'section', 'billing', ['q'])
    expect(out).toBe('https://lushnote.com.au/admin?section=billing')
  })

  it('keeps the path and the origin', () => {
    const out = withParam('https://www.lushnote.com.au/settings?tab=api-keys', 'tab', 'workplaces')
    const url = new URL(out)
    expect(url.origin).toBe('https://www.lushnote.com.au')
    expect(url.pathname).toBe('/settings')
  })

  it('encodes a value that needs it', () => {
    const out = withParam('https://lushnote.com.au/admin', 'section', 'whats-new')
    expect(new URL(out).searchParams.get('section')).toBe('whats-new')
  })
})
