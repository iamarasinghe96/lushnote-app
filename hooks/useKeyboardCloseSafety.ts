'use client'

import { useEffect } from 'react'

// Focus/blur alone isn't a reliable signal that the on-screen keyboard has
// closed on every mobile browser — Chrome on iOS in particular doesn't always
// fire a real blur event when its own keyboard-dismiss control is used, so a
// "focused" flag that only clears on blur can get stuck true forever (in this
// app, that meant the tab bar stayed hidden after typing, even once the
// keyboard was gone). visualViewport growing back to full height is a
// browser-level signal tied to the keyboard itself, so use it as an
// unconditional safety net alongside the normal onBlur handler.
export function useKeyboardCloseSafety(setFocused: (v: boolean) => void) {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    function onResize() {
      if (vv!.height >= window.innerHeight - 60) setFocused(false)
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [setFocused])
}
