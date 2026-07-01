import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyCronSecret } from '../cron-auth'

describe('verifyCronSecret', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret-abc123'
  })
  afterEach(() => {
    process.env = { ...origEnv }
  })

  it('đúng secret → true', () => {
    expect(verifyCronSecret('test-secret-abc123')).toBe(true)
  })

  it('sai secret → false', () => {
    expect(verifyCronSecret('wrong-secret')).toBe(false)
  })

  it('null → false', () => {
    expect(verifyCronSecret(null)).toBe(false)
  })

  it('empty string → false', () => {
    expect(verifyCronSecret('')).toBe(false)
  })

  it('CRON_SECRET chưa set → false', () => {
    delete process.env.CRON_SECRET
    expect(verifyCronSecret('anything')).toBe(false)
  })

  it('length mismatch → false (early exit before timingSafeEqual)', () => {
    expect(verifyCronSecret('short')).toBe(false)
  })
})
