import type { ReactNode } from 'react'

interface BadgeProps {
  variant?: 'blue' | 'green' | 'gray' | 'purple' | 'danger'
  children: ReactNode
}

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  blue:   'bg-[var(--blue-lt)] text-[var(--blue)]',
  green:  'bg-[#d1fae5] text-[#065f46]',
  gray:   'bg-[var(--bg)] text-[var(--text2)] border border-[var(--border)]',
  purple: 'bg-[#ede9fe] text-[#5b21b6]',
  danger: 'bg-red-50 text-[var(--danger)]',
}

export default function Badge({ variant = 'gray', children }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded-full
        px-2 py-0.5 text-xs font-semibold
        ${variantClasses[variant]}
      `}
    >
      {children}
    </span>
  )
}
