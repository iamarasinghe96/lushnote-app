'use client'

import { useEffect, useState, type ReactNode } from 'react'
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

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || !open) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className={`
          relative w-full ${maxWidthClasses[maxWidth]}
          backdrop-blur-md bg-white/90
          rounded-t-[20px] sm:rounded-[20px]
          border border-white/45
          animate-modal-enter overflow-hidden
        `}
        style={{ boxShadow: 'var(--shadow-lg)', willChange: 'transform, opacity' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
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
        <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
