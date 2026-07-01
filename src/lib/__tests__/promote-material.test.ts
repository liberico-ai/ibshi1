import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'
import { Prisma } from '@prisma/client'

const Decimal = Prisma.Decimal

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return { ...actual, authenticateRequest: (...a: unknown[]) => mockAuth(...a), logAudit: vi.fn() }
})

import { POST as promotePOST } from '@/app/api/materials/promote/route'
import { POST as mergePOST } from '@/app/api/materials/merge/route'

const ADMIN = { userId: 'u1', username: 'admin', roleCode: 'R10', userLevel: 1, fullName: 'Admin' }
const WORKER = { userId: 'u2', username: 'worker', roleCode: 'R06a', userLevel: 3, fullName: 'Worker' }

function makeReq(body: object) {
  return new NextRequest('http://localhost/api/materials/promote', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeMergeReq(body: object) {
  return new NextRequest('http://localhost/api/materials/merge', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  mockAuth.mockResolvedValue(ADMIN)
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock),
  )
})

describe('POST /api/materials/promote', () => {
  it('promote provisional với tồn 2 kho → target đủ MaterialStock cả 2', async () => {
    prismaMock.material.findUnique
      .mockResolvedValueOnce({
        id: 'prov1', materialCode: 'BAH-TMP-001', name: 'Thép tạm', unit: 'kg',
        category: 'BAH', isProvisional: true, status: 'PENDING', promotedToId: null,
        currentStock: new Decimal(150), reservedStock: new Decimal(10),
        specification: 'H200', grade: 'SS400', nameEn: '',
      } as never)
      .mockResolvedValueOnce({
        id: 'target1', isProvisional: false, status: 'ACTIVE',
      } as never)

    prismaMock.materialStock.findMany.mockResolvedValue([
      { id: 'ms1', materialId: 'prov1', warehouseId: 'w1', quantity: new Decimal(100), value: new Decimal(5000), updatedAt: new Date() },
      { id: 'ms2', materialId: 'prov1', warehouseId: 'w2', quantity: new Decimal(50), value: new Decimal(2500), updatedAt: new Date() },
    ] as never)

    prismaMock.stockMovement.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.bomItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseRequestItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialIssue.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.millCertificate.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialCodeAlias.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialStock.upsert.mockResolvedValue({} as never)
    prismaMock.materialStock.deleteMany.mockResolvedValue({ count: 2 } as never)
    prismaMock.material.update.mockResolvedValue({} as never)
    prismaMock.materialCodeAlias.create.mockResolvedValue({} as never)

    const res = await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'target1' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.targetId).toBe('target1')

    expect(prismaMock.materialStock.upsert).toHaveBeenCalledTimes(2)
    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materialId_warehouseId: { materialId: 'target1', warehouseId: 'w1' } },
      }),
    )
    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materialId_warehouseId: { materialId: 'target1', warehouseId: 'w2' } },
      }),
    )
  })

  it('target đã có tồn cùng kho → upsert increment', async () => {
    prismaMock.material.findUnique
      .mockResolvedValueOnce({
        id: 'prov1', materialCode: 'BAH-TMP-001', name: 'Thép tạm', unit: 'kg',
        category: 'BAH', isProvisional: true, status: 'PENDING', promotedToId: null,
        currentStock: new Decimal(100), reservedStock: new Decimal(0),
        specification: null, grade: null, nameEn: '',
      } as never)
      .mockResolvedValueOnce({ id: 'target1', isProvisional: false, status: 'ACTIVE' } as never)

    prismaMock.materialStock.findMany.mockResolvedValue([
      { id: 'ms1', materialId: 'prov1', warehouseId: 'w1', quantity: new Decimal(100), value: new Decimal(5000), updatedAt: new Date() },
    ] as never)

    prismaMock.stockMovement.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.bomItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseRequestItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialIssue.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.millCertificate.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialCodeAlias.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialStock.upsert.mockResolvedValue({} as never)
    prismaMock.materialStock.deleteMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.material.update.mockResolvedValue({} as never)
    prismaMock.materialCodeAlias.create.mockResolvedValue({} as never)

    const res = await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'target1' }))
    const body = await res.json()
    expect(body.ok).toBe(true)

    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: { increment: new Decimal(100) }, value: { increment: new Decimal(5000) } },
      }),
    )
  })

  it('7 FK tables reassigned', async () => {
    prismaMock.material.findUnique
      .mockResolvedValueOnce({
        id: 'prov1', materialCode: 'BAH-TMP-001', name: 'Test', unit: 'kg',
        category: 'BAH', isProvisional: true, status: 'PENDING', promotedToId: null,
        currentStock: new Decimal(0), reservedStock: new Decimal(0),
        specification: null, grade: null, nameEn: '',
      } as never)
      .mockResolvedValueOnce({ id: 'target1', isProvisional: false, status: 'ACTIVE' } as never)

    prismaMock.materialStock.findMany.mockResolvedValue([] as never)
    prismaMock.stockMovement.updateMany.mockResolvedValue({ count: 3 } as never)
    prismaMock.bomItem.updateMany.mockResolvedValue({ count: 2 } as never)
    prismaMock.purchaseOrderItem.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.purchaseRequestItem.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.materialIssue.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.millCertificate.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialCodeAlias.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.materialStock.deleteMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.material.update.mockResolvedValue({} as never)
    prismaMock.materialCodeAlias.create.mockResolvedValue({} as never)

    await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'target1' }))

    const reassign = { where: { materialId: 'prov1' }, data: { materialId: 'target1' } }
    expect(prismaMock.stockMovement.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.bomItem.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.purchaseOrderItem.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.purchaseRequestItem.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.materialIssue.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.millCertificate.updateMany).toHaveBeenCalledWith(reassign)
    expect(prismaMock.materialCodeAlias.updateMany).toHaveBeenCalledWith(reassign)
  })

  it('idempotent — gọi 2 lần trả alreadyPromoted', async () => {
    prismaMock.material.findUnique.mockResolvedValue({
      id: 'prov1', materialCode: 'BAH-TMP-001', name: 'Test', unit: 'kg',
      category: 'BAH', isProvisional: false, status: 'ARCHIVE', promotedToId: 'target1',
      currentStock: new Decimal(0), reservedStock: new Decimal(0),
      specification: null, grade: null, nameEn: '',
    } as never)

    const res = await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'target1' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.alreadyPromoted).toBe(true)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('reject promote mã không provisional', async () => {
    prismaMock.material.findUnique.mockResolvedValue({
      id: 'std1', materialCode: 'BAH-AOBH-001', name: 'Thép chuẩn', unit: 'kg',
      category: 'BAH', isProvisional: false, status: 'ACTIVE', promotedToId: null,
      currentStock: new Decimal(0), reservedStock: new Decimal(0),
      specification: null, grade: null, nameEn: '',
    } as never)

    const res = await promotePOST(makeReq({ provisionalId: 'std1', targetId: 'target1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/không phải mã tạm/)
  })

  it('reject promote vào mã tạm khác', async () => {
    prismaMock.material.findUnique
      .mockResolvedValueOnce({
        id: 'prov1', materialCode: 'BAH-TMP-001', name: 'Test', unit: 'kg',
        category: 'BAH', isProvisional: true, status: 'PENDING', promotedToId: null,
        currentStock: new Decimal(0), reservedStock: new Decimal(0),
        specification: null, grade: null, nameEn: '',
      } as never)
      .mockResolvedValueOnce({ id: 'prov2', isProvisional: true, status: 'PENDING' } as never)

    const res = await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'prov2' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/mã tạm khác/)
  })

  it('alias tạo + provisional archived', async () => {
    prismaMock.material.findUnique
      .mockResolvedValueOnce({
        id: 'prov1', materialCode: 'BAH-TMP-001', name: 'Thép tạm', unit: 'kg',
        category: 'BAH', isProvisional: true, status: 'PENDING', promotedToId: null,
        currentStock: new Decimal(0), reservedStock: new Decimal(0),
        specification: null, grade: null, nameEn: '',
      } as never)
      .mockResolvedValueOnce({ id: 'target1', isProvisional: false, status: 'ACTIVE' } as never)

    prismaMock.materialStock.findMany.mockResolvedValue([] as never)
    prismaMock.stockMovement.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.bomItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseRequestItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialIssue.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.millCertificate.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialCodeAlias.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialStock.deleteMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.material.update.mockResolvedValue({} as never)
    prismaMock.materialCodeAlias.create.mockResolvedValue({} as never)

    await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'target1' }))

    expect(prismaMock.materialCodeAlias.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        materialId: 'target1',
        aliasCode: 'BAH-TMP-001',
        source: 'MANUAL',
        note: 'promoted from BAH-TMP-001',
      }),
    })

    expect(prismaMock.material.update).toHaveBeenCalledWith({
      where: { id: 'prov1' },
      data: expect.objectContaining({
        status: 'ARCHIVE',
        isProvisional: false,
        currentStock: 0,
        reservedStock: 0,
        promotedToId: 'target1',
      }),
    })
  })

  it('RBAC — role không có quyền → 403', async () => {
    mockAuth.mockResolvedValue(WORKER)
    const res = await promotePOST(makeReq({ provisionalId: 'prov1', targetId: 'target1' }))
    expect(res.status).toBe(403)
  })
})

describe('REGRESSION: merge phải gộp MaterialStock per-warehouse', () => {
  it('merge 2 duplicate có tồn khác kho → survivor nhận MaterialStock cả 2 kho', async () => {
    prismaMock.material.findMany.mockResolvedValue([
      { id: 'surv' }, { id: 'dup1' },
    ] as never)

    ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock),
    )

    const findManyMaterial = prismaMock.material.findMany as ReturnType<typeof vi.fn>
    findManyMaterial.mockResolvedValueOnce([{ id: 'surv' }, { id: 'dup1' }])
    findManyMaterial.mockResolvedValueOnce([
      { id: 'dup1', materialCode: 'DUP-001', currentStock: new Decimal(50), reservedStock: new Decimal(0) },
    ])

    prismaMock.materialStock.findMany.mockResolvedValue([
      { id: 'ds1', materialId: 'dup1', warehouseId: 'w1', quantity: new Decimal(30), value: new Decimal(1500) },
      { id: 'ds2', materialId: 'dup1', warehouseId: 'w2', quantity: new Decimal(20), value: new Decimal(1000) },
    ] as never)

    prismaMock.stockMovement.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.bomItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseOrderItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.purchaseRequestItem.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialIssue.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.millCertificate.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialCodeAlias.updateMany.mockResolvedValue({ count: 0 } as never)
    prismaMock.materialStock.upsert.mockResolvedValue({} as never)
    prismaMock.materialStock.deleteMany.mockResolvedValue({ count: 2 } as never)
    prismaMock.materialCodeAlias.create.mockResolvedValue({} as never)
    prismaMock.material.update.mockResolvedValue({} as never)

    const req = makeMergeReq({ survivorId: 'surv', duplicateIds: ['dup1'] })
    const res = await mergePOST(req)
    const body = await res.json()
    expect(body.ok).toBe(true)

    expect(prismaMock.materialStock.upsert).toHaveBeenCalledTimes(2)
    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materialId_warehouseId: { materialId: 'surv', warehouseId: 'w1' } },
        update: { quantity: { increment: new Decimal(30) }, value: { increment: new Decimal(1500) } },
      }),
    )
    expect(prismaMock.materialStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { materialId_warehouseId: { materialId: 'surv', warehouseId: 'w2' } },
      }),
    )
    expect(prismaMock.materialStock.deleteMany).toHaveBeenCalledWith({
      where: { materialId: { in: ['dup1'] } },
    })
  })
})
