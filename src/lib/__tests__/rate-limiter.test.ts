import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimitStore, RATE_PRESETS } from '@/lib/rate-limiter'

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimitStore()
  })

  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('user-1', 5, 60_000)).toBe(true)
    }
  })

  it('blocks requests over the limit', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('user-2', 5, 60_000)
    }
    expect(checkRateLimit('user-2', 5, 60_000)).toBe(false)
  })

  it('uses separate counters per key', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('user-a', 5, 60_000)
    }
    expect(checkRateLimit('user-a', 5, 60_000)).toBe(false)
    expect(checkRateLimit('user-b', 5, 60_000)).toBe(true)
  })

  it('resets after the window expires', () => {
    const originalNow = Date.now
    let now = 1000000

    Date.now = () => now

    for (let i = 0; i < 5; i++) {
      checkRateLimit('user-3', 5, 1000)
    }
    expect(checkRateLimit('user-3', 5, 1000)).toBe(false)

    // Advance past the window
    now += 1001
    expect(checkRateLimit('user-3', 5, 1000)).toBe(true)

    Date.now = originalNow
  })

  it('returns true for the first request from any key', () => {
    expect(checkRateLimit('new-user', 1, 60_000)).toBe(true)
  })

  it('blocks immediately when maxRequests is 1 and second request arrives', () => {
    expect(checkRateLimit('strict-user', 1, 60_000)).toBe(true)
    expect(checkRateLimit('strict-user', 1, 60_000)).toBe(false)
  })
})

describe('RATE_PRESETS', () => {
  it('defines API_GENERAL preset', () => {
    expect(RATE_PRESETS.API_GENERAL).toEqual({ maxRequests: 100, windowMs: 60_000 })
  })

  it('defines API_UPLOAD preset', () => {
    expect(RATE_PRESETS.API_UPLOAD).toEqual({ maxRequests: 50, windowMs: 60_000 })
  })
})
