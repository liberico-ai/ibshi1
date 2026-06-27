import { describe, it, expect, vi, afterEach } from 'vitest'

describe('feature-flags', () => {
  const originalEnv = process.env.NEXT_PUBLIC_FF_BOM_CASCADE

  afterEach(() => {
    // Restore original env
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_FF_BOM_CASCADE
    } else {
      process.env.NEXT_PUBLIC_FF_BOM_CASCADE = originalEnv
    }
    // Clear module cache so the flag is re-evaluated on next import
    vi.resetModules()
  })

  it('BOM_REVISION_CASCADE is OFF by default (env var not set)', async () => {
    delete process.env.NEXT_PUBLIC_FF_BOM_CASCADE
    vi.resetModules()
    const { isEnabled } = await import('@/lib/feature-flags')
    expect(isEnabled('BOM_REVISION_CASCADE')).toBe(false)
  })

  it('BOM_REVISION_CASCADE is ON when env var is "true"', async () => {
    process.env.NEXT_PUBLIC_FF_BOM_CASCADE = 'true'
    vi.resetModules()
    const { isEnabled } = await import('@/lib/feature-flags')
    expect(isEnabled('BOM_REVISION_CASCADE')).toBe(true)
  })

  it('BOM_REVISION_CASCADE stays OFF for any value other than "true"', async () => {
    process.env.NEXT_PUBLIC_FF_BOM_CASCADE = 'yes'
    vi.resetModules()
    const { isEnabled } = await import('@/lib/feature-flags')
    expect(isEnabled('BOM_REVISION_CASCADE')).toBe(false)
  })
})
