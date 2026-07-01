import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db')

import { prismaMock } from '@/lib/__mocks__/db'

describe('saleClient', () => {
  const origEnv = { ...process.env }
  const fetchSpy = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    process.env.SALE_BASE_URL = 'https://sale.test'
    process.env.SALE_INBOUND_API_KEY = 'test-key-123'
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  async function getSaleClient() {
    const mod = await import('../sale-client')
    return mod.saleClient
  }

  it('listCustomers 200 → trả data', async () => {
    fetchSpy.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, data: [{ customerId: 'c1', name: 'Cty A' }], total: 1, page: 1, pageSize: 50 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const client = await getSaleClient()
    const res = await client.listCustomers({ page: 1 })
    expect(res.customers).toHaveLength(1)
    expect(res.customers[0].customerId).toBe('c1')
    expect(res.hasMore).toBe(false)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/external/v1/customers'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'test-key-123' }) }),
    )
  })

  it('401 → SaleClientError UNAUTHORIZED', async () => {
    fetchSpy.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const client = await getSaleClient()
    await expect(client.listCustomers({ page: 1 })).rejects.toThrow(/key không hợp lệ/)
  })

  it('503 → SaleClientError UNAVAILABLE', async () => {
    fetchSpy.mockResolvedValue(new Response('Service Unavailable', { status: 503 }))
    const client = await getSaleClient()
    await expect(client.listCustomers({ page: 1 })).rejects.toThrow(/bảo trì/)
  })

  it('timeout → SaleClientError TIMEOUT', async () => {
    fetchSpy.mockImplementation(() => {
      const err = new DOMException('The operation was aborted', 'AbortError')
      return Promise.reject(err)
    })
    const client = await getSaleClient()
    await expect(client.listCustomers({ page: 1 })).rejects.toThrow(/timeout/)
  })

  it('env thiếu + DB trống → SaleClientError ENV_MISSING', async () => {
    delete process.env.SALE_BASE_URL
    delete process.env.SALE_INBOUND_API_KEY
    prismaMock.systemConfig.findMany.mockResolvedValue([])
    const client = await getSaleClient()
    await expect(client.ping()).rejects.toThrow(/chưa cấu hình/)
  })
})
