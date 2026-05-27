interface RateLimitEntry {
  count: number
  resetAt: number // epoch ms
}

// In-memory store — resets on cold start (acceptable for serverless)
const store = new Map<string, RateLimitEntry>()

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs
    store.set(key, { count: 1, resetAt })
    return { allowed: true, remaining: maxRequests - 1, resetAt }
  }

  if (entry.count < maxRequests) {
    entry.count++
    return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
  }

  return { allowed: false, remaining: 0, resetAt: entry.resetAt }
}
