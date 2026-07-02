/**
 * Route tests for material code APIs: /resolve and /merge.
 * Prisma is deep-mocked via __mocks__/db; authenticateRequest is mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return { ...actual, authenticateRequest: (...a: unknown[]) => mockAuth(...a) }
})

import { GET as materialsGET } from '@/app/api/materials/route'
import { GET as resolveGET } from '@/app/api/materials/resolve/route'
import { POST as mergePOST } from '@/app/api/materials/merge/route'

const ADMIN = { userId: 'u1', username: 'admin', roleCode: 'R10', userLevel: 1, fullName: 'Admin' }

beforeEach(() => {
  mockAuth.mockResolvedValue(ADMIN)
  // default: transaction runs the callback with the mock client
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock),
  )
})

// ── GET /api/materials (search + limit — combobox autocomplete) ──
describe('GET /api/materials — search + limit', () => {
  const ROW = {
    id: 'm1', materialCode: 'VLH-QUEH-001', name: 'Que hàn', unit: 'kg', category: 'VLH',
    groupCode: null, specification: null, grade: null, currentStock: 5, unitPrice: 100,
    currency: 'VND', status: 'ACTIVE', isProvisional: false, createdByUnit: null,
    _count: { aliases: 0 },
  }

  beforeEach(() => {
    prismaMock.material.count.mockResolvedValue(1 as never)
    prismaMock.material.findMany.mockResolvedValue([ROW] as never)
  })

  it('search=... lọc theo materialCode/name (insensitive), limit mặc định 20', async () => {
    const res = await materialsGET(new NextRequest('http://localhost/api/materials?search=que'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.materials).toHaveLength(1)
    expect(body.pagination.limit).toBe(20)
    expect(prismaMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        skip: 0,
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { name: { contains: 'que', mode: 'insensitive' } },
            { materialCode: { contains: 'que', mode: 'insensitive' } },
          ]),
        }),
      }),
    )
  })

  it('limit được tôn trọng và cap tại 50', async () => {
    await materialsGET(new NextRequest('http://localhost/api/materials?search=que&limit=5'))
    expect(prismaMock.material.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 5 }))

    await materialsGET(new NextRequest('http://localhost/api/materials?search=que&limit=999'))
    expect(prismaMock.material.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50 }))

    // limit rác → về mặc định 20
    await materialsGET(new NextRequest('http://localhost/api/materials?search=que&limit=abc'))
    expect(prismaMock.material.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 20 }))
  })

  it('search kết hợp status=ACTIVE (combobox PR dùng)', async () => {
    await materialsGET(new NextRequest('http://localhost/api/materials?search=que&status=ACTIVE&limit=20'))
    expect(prismaMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    )
  })

  it('caller cũ (q + page) không đổi hành vi: limit 20/trang', async () => {
    await materialsGET(new NextRequest('http://localhost/api/materials?q=que&page=2'))
    expect(prismaMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 20 }),
    )
  })

  it('search mode yêu cầu đăng nhập', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await materialsGET(new NextRequest('http://localhost/api/materials?search=que'))
    expect(res.status).toBe(401)
  })

  it('legacy mode (không param) vẫn trả flat list theo currentStock > 0', async () => {
    prismaMock.material.findMany.mockResolvedValue([
      { id: 'm1', materialCode: 'VLH-QUEH-001', name: 'Que hàn', unit: 'kg', category: 'VLH', groupCode: null, specification: null, grade: null, currentStock: 5 },
    ] as never)
    const res = await materialsGET(new NextRequest('http://localhost/api/materials'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(prismaMock.material.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { currentStock: { gt: 0 } } }),
    )
  })
})

// ── GET /api/materials?countProvisional=1 (badge sidebar + card cảnh báo) ──
describe('GET /api/materials — countProvisional=1', () => {
  it('trả pendingCount = số mã tạm chờ chuẩn hóa (đúng where)', async () => {
    prismaMock.material.count.mockResolvedValue(7 as never)
    const res = await materialsGET(new NextRequest('http://localhost/api/materials?countProvisional=1'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.pendingCount).toBe(7)
    expect(prismaMock.material.count).toHaveBeenCalledWith({
      where: {
        isProvisional: true,
        promotedToId: null,
        status: { notIn: ['ARCHIVE', 'OBSOLETE'] },
      },
    })
    // count mode không query danh sách
    expect(prismaMock.material.findMany).not.toHaveBeenCalled()
  })

  it('yêu cầu đăng nhập (401 khi chưa auth)', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await materialsGET(new NextRequest('http://localhost/api/materials?countProvisional=1'))
    expect(res.status).toBe(401)
    expect(prismaMock.material.count).not.toHaveBeenCalled()
  })

  it('không kích hoạt khi countProvisional khác 1 — caller cũ không đổi hành vi', async () => {
    prismaMock.material.count.mockResolvedValue(1 as never)
    prismaMock.material.findMany.mockResolvedValue([] as never)
    const res = await materialsGET(new NextRequest('http://localhost/api/materials?q=que&countProvisional=0'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.pendingCount).toBeUndefined()
    expect(body.materials).toBeDefined()
  })
})

// ── /resolve ──
describe('GET /api/materials/resolve', () => {
  it('resolves a canonical code', async () => {
    prismaMock.material.findUnique.mockResolvedValue({ id: 'm1', materialCode: 'VLH-QUEH-001', name: 'Que hàn', currentStock: 5, reservedStock: 0, unitPrice: 100, aliases: [] } as never)
    const res = await resolveGET(new NextRequest('http://localhost/api/materials/resolve?code=VLH-QUEH-001'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.resolvedFrom).toBe('canonical')
    expect(body.material.materialCode).toBe('VLH-QUEH-001')
  })

  it('resolves via an alias (old code)', async () => {
    prismaMock.material.findUnique.mockResolvedValue(null as never)
    prismaMock.materialCodeAlias.findUnique.mockResolvedValue({
      aliasCode: 'VLH.QUEH.001', materialId: 'm1',
      material: { id: 'm1', materialCode: 'VLH-QUEH-001', name: 'Que hàn', currentStock: 5, reservedStock: 0, unitPrice: 100, aliases: [] },
    } as never)
    const res = await resolveGET(new NextRequest('http://localhost/api/materials/resolve?code=VLH.QUEH.001'))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.resolvedFrom).toBe('alias')
    expect(body.material.materialCode).toBe('VLH-QUEH-001')
  })

  it('returns 404 when no code matches', async () => {
    prismaMock.material.findUnique.mockResolvedValue(null as never)
    prismaMock.materialCodeAlias.findUnique.mockResolvedValue(null as never)
    const res = await resolveGET(new NextRequest('http://localhost/api/materials/resolve?code=NOPE'))
    expect(res.status).toBe(404)
    expect((await res.json()).ok).toBe(false)
  })

  it('returns 400 when code param is missing', async () => {
    const res = await resolveGET(new NextRequest('http://localhost/api/materials/resolve'))
    expect(res.status).toBe(400)
  })
})

// ── /merge ──
function mergeReq(payload: unknown) {
  return new NextRequest('http://localhost/api/materials/merge', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/materials/merge', () => {
  it('forbids roles not allowed to merge', async () => {
    mockAuth.mockResolvedValue({ ...ADMIN, roleCode: 'R05' })
    const res = await mergePOST(mergeReq({ survivorId: 'S', duplicateIds: ['D1'] }))
    expect(res.status).toBe(403)
  })

  it('rejects when survivor is also in the duplicate list', async () => {
    const res = await mergePOST(mergeReq({ survivorId: 'S', duplicateIds: ['S'] }))
    expect(res.status).toBe(400)
  })

  it('reassigns FKs, folds stock, aliases the old codes, and archives duplicates', async () => {
    // existence check (outside tx) then dups detail (inside tx)
    prismaMock.material.findMany
      .mockResolvedValueOnce([{ id: 'S' }, { id: 'D1' }] as never)
      .mockResolvedValueOnce([{ id: 'D1', materialCode: 'OLD-1', currentStock: 3, reservedStock: 1 }] as never)

    prismaMock.materialStock.findMany.mockResolvedValue([] as never)
    prismaMock.materialStock.deleteMany.mockResolvedValue({ count: 0 } as never)

    const res = await mergePOST(mergeReq({ survivorId: 'S', duplicateIds: ['D1'] }))
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.mergedCount).toBe(1)
    // FK reassignment across the 6 referencing tables + aliases
    const reassign = { where: { materialId: { in: ['D1'] } }, data: { materialId: 'S' } }
    expect(prismaMock.stockMovement.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.bomItem.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.purchaseOrderItem.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.purchaseRequestItem.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.materialIssue.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.millCertificate.updateMany).toHaveBeenCalledWith(reassign)
    // old code becomes an alias of the survivor
    expect(prismaMock.materialCodeAlias.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ materialId: 'S', aliasCode: 'OLD-1', source: 'MANUAL' }) }),
    )
    // survivor stock incremented by folded stock (3) and reserved (1)
    expect(prismaMock.material.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'S' }, data: { currentStock: { increment: 3 }, reservedStock: { increment: 1 } } }),
    )
    // duplicate archived
    expect(prismaMock.material.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'D1' }, data: expect.objectContaining({ status: 'ARCHIVE' }) }),
    )
  })
})
