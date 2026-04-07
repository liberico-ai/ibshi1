// ── In-memory rate limiter ──

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Cleanup stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of rateLimitStore) {
      if (now > val.resetAt) rateLimitStore.delete(key)
    }
  }, 300_000)
}

/**
 * Check if a request should be rate-limited.
 * Returns `true` if the request is allowed, `false` if it should be blocked.
 */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }

  record.count++
  return record.count <= maxRequests
}

/** Reset rate limit state (useful for testing) */
export function resetRateLimitStore(): void {
  rateLimitStore.clear()
}

// ── Presets ──
export const RATE_PRESETS = {
  API_GENERAL: { maxRequests: 100, windowMs: 60_000 },
  API_UPLOAD: { maxRequests: 50, windowMs: 60_000 }, // Tăng từ 10 lên 50 để upload nhiều file (kéo/thả) không bị block
} as const
