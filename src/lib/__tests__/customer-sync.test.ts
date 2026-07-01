import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')

const mockListCustomers = vi.fn()
vi.mock('@/lib/sale-client', () => ({
  saleClient: { listCustomers: (...args: unknown[]) => mockListCustomers(...args) },
  SaleClientError: class extends Error { status: number; code: string; constructor(m: string, s: number, c: string) { super(m); this.status = s; this.code = c } },
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { runCustomerSync, normName } from '../cron-jobs'

beforeEach(() => {
  mockListCustomers.mockReset()
})

describe('normName', () => {
  it('bỏ dấu + hạ case + bỏ hậu tố pháp nhân', () => {
    expect(normName('Công Ty TNHH Thép Việt')).toBe('thep viet')
  })

  it('bỏ Co. Ltd.', () => {
    expect(normName('Acme Steel Co. Ltd.')).toBe('acme steel')
  })

  it('bỏ JSC', () => {
    expect(normName('IBS Heavy Industry JSC')).toBe('ibs heavy industry')
  })

  it('trim + collapse spaces', () => {
    expect(normName('  Hello   World  ')).toBe('hello world')
  })

  it('bỏ Công ty Cổ phần', () => {
    expect(normName('Công ty Cổ phần Xây dựng ABC')).toBe('xay dung abc')
  })
})

describe('runCustomerSync', () => {
  it('2 trang → upsert count + cursor cập nhật', async () => {
    mockListCustomers
      .mockResolvedValueOnce({
        customers: [
          { customerId: 'c1', name: 'Cty A', updatedAt: '2026-06-01T00:00:00Z' },
          { customerId: 'c2', name: 'Cty B', updatedAt: '2026-06-02T00:00:00Z' },
        ],
        hasMore: true, total: 3, page: 1, pageSize: 2,
      })
      .mockResolvedValueOnce({
        customers: [
          { customerId: 'c3', name: 'Cty C', updatedAt: '2026-06-03T00:00:00Z' },
        ],
        hasMore: false, total: 3, page: 2, pageSize: 2,
      })

    prismaMock.systemConfig.findUnique.mockResolvedValue(null)
    prismaMock.saleCustomer.upsert.mockResolvedValue({} as never)
    prismaMock.systemConfig.upsert.mockResolvedValue({} as never)

    const result = await runCustomerSync()
    expect(result.upserted).toBe(3)
    expect(result.pages).toBe(2)
    expect(result.cursor).toBe('2026-06-03T00:00:00Z')
    expect(prismaMock.saleCustomer.upsert).toHaveBeenCalledTimes(3)
  })

  it('backfill 1970 khi chưa có cursor', async () => {
    mockListCustomers.mockResolvedValueOnce({
      customers: [], hasMore: false, total: 0, page: 1, pageSize: 50,
    })
    prismaMock.systemConfig.findUnique.mockResolvedValue(null)
    prismaMock.systemConfig.upsert.mockResolvedValue({} as never)

    await runCustomerSync()
    expect(mockListCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ modifiedSince: '1970-01-01T00:00:00Z' }),
    )
  })

  it('idempotent — upsert gọi đúng customerId', async () => {
    mockListCustomers.mockResolvedValueOnce({
      customers: [{ customerId: 'c1', name: 'Cty A' }],
      hasMore: false, total: 1, page: 1, pageSize: 50,
    })
    prismaMock.systemConfig.findUnique.mockResolvedValue({ key: 'x', value: '2026-01-01T00:00:00Z', updatedAt: new Date() })
    prismaMock.saleCustomer.upsert.mockResolvedValue({} as never)
    prismaMock.systemConfig.upsert.mockResolvedValue({} as never)

    await runCustomerSync()
    expect(prismaMock.saleCustomer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { saleCustomerId: 'c1' },
        create: expect.objectContaining({ saleCustomerId: 'c1', name: 'Cty A' }),
      }),
    )
  })

  it('tối đa 3 trang mỗi lần chạy', async () => {
    for (let i = 0; i < 4; i++) {
      mockListCustomers.mockResolvedValueOnce({
        customers: [{ customerId: `c${i}`, name: `Cty ${i}` }],
        hasMore: true, total: 100, page: i + 1, pageSize: 1,
      })
    }
    prismaMock.systemConfig.findUnique.mockResolvedValue(null)
    prismaMock.saleCustomer.upsert.mockResolvedValue({} as never)
    prismaMock.systemConfig.upsert.mockResolvedValue({} as never)

    const result = await runCustomerSync()
    expect(result.pages).toBe(3)
    expect(mockListCustomers).toHaveBeenCalledTimes(3)
  })
})
