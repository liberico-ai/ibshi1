import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockWarehouseUser } = vi.hoisted(() => ({
  mockWarehouseUser: {
    userId: 'user-store',
    roleCode: 'R05', // Thủ kho (warehouse manager)
    username: 'warehouse',
    userLevel: 2,
    fullName: 'Warehouse User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockWarehouseUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/cache', () => ({
  withCache: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
  cacheInvalidate: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: { projects: 'projects:*', dashboard: 'dashboard:*', tasks: 'tasks:*', warehouse: 'warehouse:*', admin: 'admin:*' },
}))

import { GET, POST } from '@/app/api/stock-movements/route'
import { authenticateRequest } from '@/lib/auth'

const SAMPLE_MATERIAL = {
  id: 'mat-1',
  materialCode: 'ST-001',
  name: 'Steel Plate',
  unit: 'kg',
  currentStock: 1000,
  category: 'Steel',
}

const SAMPLE_MOVEMENT = {
  id: 'mov-1',
  materialId: 'mat-1',
  type: 'IN',
  quantity: 100,
  reason: 'Nhập kho',
  referenceNo: null,
  heatNumber: null,
  lotNumber: null,
  performedBy: 'user-store',
  createdAt: new Date(),
}

describe('GET /api/stock-movements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockWarehouseUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const req = new Request('http://localhost/api/stock-movements')
    const res = await GET(req as any)
    expect(res.status).toBe(401)
  })

  it('returns paginated stock movements list', async () => {
    prismaMock.stockMovement.count.mockResolvedValue(1)
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { ...SAMPLE_MOVEMENT, quantity: 100, material: { materialCode: 'ST-001', name: 'Steel Plate', unit: 'kg' } },
    ] as any)

    const req = new Request('http://localhost/api/stock-movements?page=1')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.movements).toHaveLength(1)
    expect(json.movements[0].quantity).toBe(100)
    expect(json.pagination).toMatchObject({ page: 1, total: 1 })
  })
})

describe('POST /api/stock-movements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockWarehouseUser)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'IN', quantity: 100, reason: 'Test' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user role is not authorized for stock movements', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockWarehouseUser, roleCode: 'R02' })

    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'IN', quantity: 100, reason: 'Test' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 400 when required fields are missing', async () => {
    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1' }), // missing type, quantity, reason
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 400 when quantity is not positive', async () => {
    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'IN', quantity: -5, reason: 'Test' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 404 when material does not exist', async () => {
    prismaMock.material.findUnique.mockResolvedValue(null)

    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'nonexistent', type: 'IN', quantity: 100, reason: 'Test' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('returns 400 when OUT movement has insufficient stock', async () => {
    prismaMock.material.findUnique.mockResolvedValue({ ...SAMPLE_MATERIAL, currentStock: 50 } as any)

    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'OUT', quantity: 100, reason: 'Xuất kho' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('tồn kho')
  })

  it('creates IN movement and returns 201', async () => {
    prismaMock.material.findUnique.mockResolvedValue(SAMPLE_MATERIAL as any)
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.stockMovement.create.mockResolvedValue(SAMPLE_MOVEMENT as any)
    prismaMock.material.update.mockResolvedValue({} as any)

    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'IN', quantity: 100, reason: 'Nhập hàng mới' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.movement).toBeTruthy()
    expect(json.message).toContain('Đã nhập')
  })

  it('creates OUT movement when stock is sufficient', async () => {
    prismaMock.material.findUnique.mockResolvedValue({ ...SAMPLE_MATERIAL, currentStock: 500 } as any)
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock))
    prismaMock.stockMovement.create.mockResolvedValue({ ...SAMPLE_MOVEMENT, type: 'OUT' } as any)
    prismaMock.material.update.mockResolvedValue({} as any)

    const req = new Request('http://localhost/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ materialId: 'mat-1', type: 'OUT', quantity: 100, reason: 'Xuất cho sản xuất' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.message).toContain('Đã xuất')
  })
})
