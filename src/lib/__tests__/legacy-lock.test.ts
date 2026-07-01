import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db')

describe('Legacy API locks (410 Gone)', () => {
  it('POST /api/safety returns 410', async () => {
    const { POST } = await import('@/app/api/safety/route')
    const res = await POST()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('/api/hse/incidents')
  })

  it('POST /api/safety/[id]/status returns 410', async () => {
    const { POST } = await import('@/app/api/safety/[id]/status/route')
    const res = await POST()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('/api/hse/incidents')
  })

  it('POST /api/delivery returns 410', async () => {
    const { POST } = await import('@/app/api/delivery/route')
    const res = await POST()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('logistics')
  })

  it('PATCH /api/delivery returns 410', async () => {
    const { PATCH } = await import('@/app/api/delivery/route')
    const res = await PATCH()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('logistics')
  })
})
