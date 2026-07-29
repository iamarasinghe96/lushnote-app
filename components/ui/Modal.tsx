'use client'

import { useEffect, useState, type ReactNode, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  maxWidth?: 'sm' | 'md' | 'lg'
  children: ReactNode
}

const maxWidthClasses = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' }

export default function Modal({ open, onClose, title, maxWidth = 'md', children }: ModalProps) {
  const [mounted, setMounted] = useState(false)
  // Visual-viewport geometry. iOS Chrome does NOT shrink the layout viewport when
  // the on-screen keyboard opens (Safari does), so a bottom-anchored sheet stays
  // pinned behind the keyboard and its inputs are hidden. Tracking the visual
  // viewport lets us confine the modal to the actually-visible region and lift it
  // above the keyboard. `null` until measured (SSR / no support → old behaviour).
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const vvp = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vvp) return
    const update = () => setVv({ top: vvp.offsetTop, height: vvp.height })
    update()
    vvp.addEventListener('resize', update)
    vvp.addEventListener('scroll', update)
    return () => {
      vvp.removeEventListener('resize', update)
      vvp.removeEventListener('scroll', update)
      setVv(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || !open) return null

  // How much of the layout viewport the keyboard is covering at the bottom. Only
  // treat it as "keyboard open" past a threshold so a normal (unshrunk) viewport
  // keeps the original centred/80dvh behaviour untouched.
  const kbInset = vv ? Math.max(0, window.innerHeight - vv.height - vv.top) : 0
  const keyboardOpen = kbInset > 120
  const overlayStyle = keyboardOpen && vv ? { top: vv.top, height: vv.height, bottom: 'auto' as const } : undefined
  const bodyMaxHeight = keyboardOpen && vv ? `${Math.max(160, vv.height - 72)}px` : '80dvh'

  // On focus, nudge the focused field into view within the scroll body — iOS
  // Chrome won't always do this inside a nested scroller once the keyboard opens.
  function handleFocusCapture(e: FocusEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={overlayStyle}
      onMouseDown={onClose}
      role="dialog"
      aria-modal
    >
      <div
        data-glass
        className={`
          ln-glass ln-glass-modal relative w-full ${maxWidthClasses[maxWidth]}
          rounded-t-[20px] sm:rounded-[20px]
          animate-modal-enter overflow-hidden flex flex-col max-h-full
        `}
        style={{ boxShadow: 'var(--shadow-lg)', willChange: 'transform, opacity', zIndex: 0 }}
        onMouseDown={e => e.stopPropagation()}
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-semibold text-[var(--text)] text-base">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-7 h-7 rounded-full bg-[var(--bg)] flex items-center justify-center
                         text-[var(--text3)] hover:text-[var(--text)] active:scale-95 transition"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
                   strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="1" y1="1" x2="13" y2="13"/>
                <line x1="13" y1="1" x2="1" y2="13"/>
              </svg>
            </button>
          </div>
        )}
        <div
          className="overflow-y-auto flex-1 min-h-0"
          style={{ maxHeight: bodyMaxHeight, paddingBottom: 'env(safe-area-inset-bottom)' }}
          onFocusCapture={handleFocusCapture}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
