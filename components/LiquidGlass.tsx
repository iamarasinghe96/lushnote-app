'use client'

import { useEffect } from 'react'

// Rec. 709 relative luminance, 0 (black) – 1 (white).
function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.4115 * b) / 255
}

// Walk up from the topmost element under (x, y) until a non-transparent
// background colour resolves — the BYD approach to "what's behind the glass".
function backdropLuminanceAt(x: number, y: number, exclude: HTMLElement): number | null {
  const stack = document.elementsFromPoint(x, y)
  for (const hit of stack) {
    if (hit === exclude || exclude.contains(hit) || hit.closest('[data-glass]')) continue
    let node: Element | null = hit
    while (node) {
      const m = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/)
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s))
        const alpha = parts[3] === undefined ? 1 : parts[3]
        if (alpha > 0.2) return luminance(parts[0], parts[1], parts[2])
      }
      node = node.parentElement
    }
  }
  return null
}

/**
 * Drives the liquid-glass effect:
 *  1. Sets the `lg-distort` capability flag on engines that render the SVG
 *     displacement filter cleanly (iOS/iPadOS Safari clips it, so it stays on
 *     the frost-only fallback).
 *  2. Samples the luminance behind every [data-glass-adaptive] surface and
 *     toggles light-glass / dark-glass so the tint adapts to its backdrop.
 * Renders nothing — the #glass-distortion filter itself is static markup in the
 * root layout.
 */
export function LiquidGlass() {
  useEffect(() => {
    const root = document.documentElement

    const ua = navigator.userAgent
    const isIOS =
      /iP(hone|ad|od)/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const supportsBlur =
      typeof CSS !== 'undefined' &&
      (CSS.supports('backdrop-filter', 'blur(2px)') ||
        CSS.supports('-webkit-backdrop-filter', 'blur(2px)'))
    if (supportsBlur && !isIOS) root.classList.add('lg-distort')

    let raf = 0
    function sample() {
      raf = 0
      const surfaces = document.querySelectorAll<HTMLElement>('[data-glass-adaptive]')
      surfaces.forEach(el => {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        // Probe just outside the surface, on the side its content sits.
        const probeY = rect.top < window.innerHeight / 2 ? rect.bottom + 6 : rect.top - 6
        let sum = 0
        let n = 0
        for (const f of [0.15, 0.35, 0.5, 0.65, 0.85]) {
          const lume = backdropLuminanceAt(rect.left + rect.width * f, probeY, el)
          if (lume !== null) {
            sum += lume
            n++
          }
        }
        if (n === 0) return
        const avg = sum / n
        el.style.setProperty('--avg-lume', avg.toFixed(3))
        el.classList.toggle('dark-glass', avg < 0.5)
        el.classList.toggle('light-glass', avg >= 0.5)
      })
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(sample)
    }

    sample()
    // capture:true catches scroll from inner containers too, not just window.
    window.addEventListener('scroll', schedule, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return null
}
