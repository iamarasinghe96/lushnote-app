import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// A doctor who has asked their phone to stop animating things has usually done
// so for a reason - motion sensitivity, vestibular disorder, or simply working
// on a device that cannot keep up. The house rule calls this non-negotiable and,
// until now, nothing checked it.
//
// Read the stylesheet the way tests/unit/csp.test.ts reads next.config.mjs:
// neither file is executed by anything in this repo, so neither is covered by
// any other test. The browser is what runs them, which is exactly why a
// regression here is invisible until somebody complains.

const css = readFileSync('app/globals.css', 'utf8')

function reducedMotionBlock(): string {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(start, 'the reduced-motion block is missing entirely').toBeGreaterThan(-1)
  // Far enough to cover the block without needing a CSS parser.
  return css.slice(start, start + 800)
}

describe('prefers-reduced-motion', () => {
  it('exists at all', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('clears duration for animations and transitions', () => {
    const block = reducedMotionBlock()
    expect(block).toContain('animation-duration')
    expect(block).toContain('transition-duration')
  })

  // The one that gets forgotten. With animation-fill-mode: both, a staggered
  // element stays invisible for the length of its delay even when the duration
  // is clamped to nothing - so the FAB tray would simply not appear.
  it('clears DELAY as well, not just duration', () => {
    const block = reducedMotionBlock()
    expect(block).toContain('animation-delay')
    expect(block).toContain('transition-delay')
  })

  it('applies to pseudo-elements, where most of the glass animation lives', () => {
    const block = reducedMotionBlock()
    expect(block).toMatch(/\*::before/)
    expect(block).toMatch(/\*::after/)
  })
})
