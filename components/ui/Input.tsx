import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export default function Input({ label, error, hint, className = '', id, ...rest }: InputProps) {
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-[var(--text)] mb-1">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`
          w-full rounded-[var(--r)] border border-[var(--border)] bg-white
          px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text3)]
          outline-none
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
