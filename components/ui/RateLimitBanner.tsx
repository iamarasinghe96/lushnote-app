'use client'

import { useEffect, useState } from 'react'

interface RateLimitBannerProps {
  waitSeconds: number
  onDismiss: () => void
  onRetry: () => void
}

export function RateLimitBanner({ waitSeconds, onDismiss, onRetry }: RateLimitBannerProps) {
  const [remaining, setRemaining] = useState(Math.max(0, waitSeconds))
  const ready = remaining <= 0
  const isLong = waitSeconds > 120

  useEffect(() => {
    if (remaining <= 0) return
    const timer = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000)
    return () => clearInterval(timer)
  }, [remaining <= 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const hrs  = Math.floor(remaining / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  const secs = remaining % 60
  const timeStr = hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`

  const label = isLong ? 'Groq daily token limit' : 'Groq rate limit'
  const progress = Math.min(100, ((waitSeconds - remaining) / waitSeconds) * 100)

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-900">
            {ready
              ? `${label} — ready to retry`
              : <>{label} — please try again in <span className="font-mono font-bold">{timeStr}</span></>
            }
          </p>
          {!ready && (
            <div className="mt-2 h-1.5 bg-amber-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full motion-safe:transition-[width] motion-safe:duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ready && (
            <button
              onClick={onRetry}
              className="text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 active:scale-95 px-3 py-1.5 rounded-lg motion-safe:transition-all"
            >
              Try again
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-xs text-amber-600 hover:text-amber-800 motion-safe:transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
