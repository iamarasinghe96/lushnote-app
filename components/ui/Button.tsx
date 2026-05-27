import type { ReactNode } from 'react'

interface ButtonProps {
  variant?: 'primary' | 'outline' | 'gray' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
  className?: string
  children: ReactNode
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-[var(--blue)] text-white shadow-sm hover:bg-[var(--blue-dk)]',
  outline: 'bg-white border border-[var(--blue)] text-[var(--blue)] hover:bg-[var(--blue-lt)]',
  gray:    'bg-[var(--bg)] border border-[var(--border)] text-[var(--text2)] hover:bg-[var(--border)]',
  danger:  'bg-[var(--danger)] text-white shadow-sm hover:opacity-90',
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-[var(--r-sm)]',
  md: 'px-4 py-2   text-sm rounded-[var(--r)]',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
  children,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2 font-medium
        transition-all duration-100
        active:scale-[0.97]
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      style={{ willChange: 'transform' }}
    >
      {loading && (
        <svg
          width="14" height="14" viewBox="0 0 24 24"
          className="animate-spin shrink-0" aria-hidden
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                  fill="none" strokeOpacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3"
                fill="none" strokeLinecap="round"/>
        </svg>
      )}
      {children}
    </button>
  )
}
