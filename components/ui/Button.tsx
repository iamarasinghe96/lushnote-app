import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  loading?: boolean
  children: ReactNode
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:   'bg-[#10b981] text-white hover:bg-[#059669] border border-transparent',
  secondary: 'bg-transparent text-[var(--blue)] border border-[var(--blue)] hover:bg-[var(--blue-lt)]',
  ghost:     'bg-transparent text-[var(--text2)] border border-[var(--text3)] hover:bg-[var(--bg)] hover:border-[var(--text2)]',
  danger:    'bg-[var(--danger)] text-white hover:bg-red-700 border border-transparent',
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  md: 'px-4 py-2.5 text-sm rounded-[var(--r)]',
  sm: 'px-3 py-1.5 text-xs rounded-[var(--r-sm)]',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading
  return (
    <button
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center gap-2 font-medium transition-colors
        ${!isDisabled ? 'active:scale-[0.97]' : 'opacity-50 cursor-not-allowed'}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      style={{ willChange: 'transform' }}
      {...rest}
    >
      {loading && (
        <svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin shrink-0" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
        </svg>
      )}
      {children}
    </button>
  )
}
