'use client'

import { useEffect, useRef } from 'react'
import { isReloadRisky } from '@/lib/reloadGuard'

// The app uses a fixed 100dvh layout with `overflow: hidden` on <body>, so the
// browser's native pull-to-refresh never fires (it needs the document itself to
// be the scroller at scrollTop 0). This adds it back manually: when the touched
// scroll container is already at the top and the doctor pulls down, show an
// indicator and reload past a threshold. Touch-only — desktop is unaffected.
const THRESHOLD = 72   // px of pull needed to trigger a refresh
const MAX_PULL = 110   // clamp so the indicator never runs away
const RESISTANCE = 0.5 // finger travel → indicator travel (rubber-band feel)

export function PullToRefresh() {
  const indicatorRef = useRef<HTMLDivElement>(null)
  const spinnerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let startY: number | null = null
    let scroller: HTMLElement | null = null
    let pull = 0
    let active = false
    let refreshing = false

    function scrollableAncestor(el: Element | null): HTMLElement | null {
      let node = el as HTMLElement | null
      while (node && node !== document.body) {
        const oy = getComputedStyle(node).overflowY
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node
        node = node.parentElement
      }
      return null
    }

    function paint() {
      const ind = indicatorRef.current
      if (!ind) return
      const progress = Math.min(1, pull / THRESHOLD)
      ind.style.transform = `translate(-50%, ${pull - 44}px)`
      ind.style.opacity = String(Math.min(1, pull / 24))
      if (spinnerRef.current) spinnerRef.current.style.transform = `rotate(${progress * 270}deg)`
    }

    function reset(animate: boolean) {
      pull = 0
      active = false
      const ind = indicatorRef.current
      if (!ind) return
      ind.style.transition = animate ? 'transform 200ms ease, opacity 200ms ease' : 'none'
      ind.style.transform = 'translate(-50%, -44px)'
      ind.style.opacity = '0'
    }

    function onStart(e: TouchEvent) {
      if (refreshing || e.touches.length !== 1) return
      const target = e.target as Element
      if (target.closest('[role="dialog"]')) return   // modals handle their own scroll
      scroller = scrollableAncestor(target)
      if (!scroller || scroller.scrollTop > 0) { startY = null; return }
      startY = e.touches[0].clientY
      if (indicatorRef.current) indicatorRef.current.style.transition = 'none'
    }

    function onMove(e: TouchEvent) {
      if (startY === null || refreshing) return
      if (scroller && scroller.scrollTop > 0) { startY = null; reset(true); return }
      const dy = e.touches[0].clientY - startY
      if (dy <= 0) { if (active) reset(false); active = false; return }
      // Pulling DOWN while already at the top — there's nothing to scroll above,
      // so the only native behaviour is the rubber-band overscroll. Suppress it
      // from the very first move: iOS WebKit (Safari, and Brave/Chrome on iOS)
      // decides a touch sequence is a native scroll on the first move and then
      // marks the rest non-cancelable, so a late preventDefault (the old
      // `pull > 4` gate) never worked there and the gesture was hijacked.
      if (e.cancelable) e.preventDefault()
      active = true
      pull = Math.min(MAX_PULL, dy * RESISTANCE)
      paint()
    }

    function onEnd() {
      if (startY === null) { return }
      const trigger = active && pull >= THRESHOLD
      startY = null
      if (!trigger) { reset(true); return }
      if (isReloadRisky() && !window.confirm('Refresh the page? Unsaved changes on this screen will be lost.')) {
        reset(true)
        return
      }
      refreshing = true
      if (indicatorRef.current) {
        indicatorRef.current.style.transition = 'transform 150ms ease'
        indicatorRef.current.style.transform = 'translate(-50%, 20px)'
        indicatorRef.current.style.opacity = '1'
      }
      if (spinnerRef.current) spinnerRef.current.style.animation = 'spin 0.7s linear infinite'
      window.location.reload()
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div
      ref={indicatorRef}
      aria-hidden
      className="fixed left-1/2 z-[120] pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top) + 8px)', transform: 'translate(-50%, -44px)', opacity: 0, willChange: 'transform, opacity' }}
    >
      <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center" style={{ boxShadow: '0 2px 10px rgba(15,23,42,0.18)' }}>
        <div ref={spinnerRef} className="w-5 h-5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="#e2e8f0" strokeWidth="3" />
            <path d="M12 3a9 9 0 0 1 9 9" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  )
}
