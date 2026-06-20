'use client'

import { useRef, useEffect, type TextareaHTMLAttributes } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
  autoResize?: boolean
}

export default function Textarea({ label, error, hint, autoResize, className = '', id, rows = 4, ...rest }: TextareaProps) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!autoResize || !ref.current) return
    const el = ref.current
    el.style.height = 'auto'
    // Keep at least `rows` worth of height so short fields don't collapse.
    const lineHeight = 20 // text-sm line-height ≈ 20px
    const minHeight = (typeof rows === 'number' ? rows : 4) * lineHeight + 20 // + py-2.5 padding
    el.style.height = Math.max(el.scrollHeight, minHeight) + 'px'
  }, [rest.value, autoResize, rows])

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-[var(--text)] mb-1">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className={`
          w-full rounded-[var(--r)] border border-[var(--border)] bg-white
          px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
          outline-none ${autoResize ? 'resize-none overflow-hidden' : 'resize-y'}
          focus:border-[var(--blue)] focus:ring-2 focus:ring-blue-500/10
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
          ${error ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-red-500/10' : ''}
          ${className}
        `}
        {...rest}
      />
      {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-[var(--text3)]">{hint}</p>}
    </div>
  )
}
