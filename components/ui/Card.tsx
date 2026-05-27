import type { ReactNode } from 'react'

interface CardProps {
  className?: string
  children: ReactNode
}

export default function Card({ className = '', children }: CardProps) {
  return (
    <div
      className={`bg-white border border-[var(--border)] rounded-[var(--r-lg)] p-5 ${className}`}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {children}
    </div>
  )
}
