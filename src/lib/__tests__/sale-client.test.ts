import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('saleClient', () => {
  const origEnv = { ...process.env }
  const fetchSpy = vi.fn()

  beforeEach(() => {
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
      JSON.stringify({ ok: true, data: { customers: [{ id: 'c1', name: 'Cty A' }], hasMore: false } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const client = await getSaleClient()
    const res = await client.listCustomers({ limit: 100 })
    expect(res.customers).toHaveLength(1)
    expect(res.hasMore).toBe(false)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/customers'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'test-key-123' }) }),
    )
  })

  it('401 → SaleClientError UNAUTHORIZED', async () => {
    fetchSpy.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const client = await getSaleClient()
    await expect(client.ping()).rejects.toThrow(/key không hợp lệ/)
  })

  it('503 → SaleClientError UNAVAILABLE', async () => {
    fetchSpy.mockResolvedValue(new Response('Service Unavailable', { status: 503 }))
    const client = await getSaleClient()
    await expect(client.ping()).rejects.toThrow(/bảo trì/)
  })

  it('timeout → SaleClientError TIMEOUT', async () => {
    fetchSpy.mockImplementation(() => {
      const err = new DOMException('The operation was aborted', 'AbortError')
      return Promise.reject(err)
    })
    const client = await getSaleClient()
    await expect(client.ping()).rejects.toThrow(/timeout/)
  })

  it('env thiếu → SaleClientError ENV_MISSING', async () => {
    delete process.env.SALE_BASE_URL
    const client = await getSaleClient()
    await expect(client.ping()).rejects.toThrow(/chưa cấu hình/)
  })
})
