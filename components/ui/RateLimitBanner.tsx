'use client'

import { useEffect, useState } from 'react'

interface RateLimitBannerProps {
  waitSeconds: number
  onDismiss: () => void
  onRetry: () => void
}

export function RateLimitBanner({ waitSeconds, onDismiss, onRetry }: RateLimitBannerProps) {
  const [remaining, setRemaining] = useState(waitSeconds)

  useEffect(() => {
    if (remaining <= 0) { onRetry(); return }
    const timer = setInterval(() => setRemaining(r => r - 1), 1000)
    return () => clearInterval(timer)
  }, [remaining])

  const progress = ((waitSeconds - remaining) / waitSeconds) * 100

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 shrink-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-amber-800">
          Groq rate limit - retrying in {remaining}s
        </span>
        <button
          onClick={onDismiss}
          className="text-xs text-amber-500 hover:text-amber-700 motion-safe:transition-colors"
        >
          Dismiss
        </button>
      </div>
      <div className="h-1 bg-amber-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full motion-safe:transition-[width] motion-safe:duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
