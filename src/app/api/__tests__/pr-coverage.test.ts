/**
 * Tests cho PR coverage (P2-đợt2 B1 — PR đã duyệt nhưng PO chưa phủ đủ)
 *
 * - GET /api/purchase-requests/[id]/coverage:
 *   - Phủ đủ (cộng dồn nhiều PO) → fullyCovered, coveragePct 100
 *   - Thiếu → per-item shortage đúng, coveragePct đúng
 *   - Where loại PO DRAFT/CANCELLED/REJECTED + đúng projectId/materialIds
 *   - PO item materialId = null → bỏ qua, không cộng coverage
 *   - PR không tồn tại → 404
 * - GET /api/purchase-requests?withCoverage=1:
 *   - PR APPROVED có coverage, PR khác coverage=null, shape cũ giữ nguyên
 *   - Không có flag → không có field coverage, không query PO
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R06b', // công nhân — coverage đọc được với MỌI role đăng nhập
    username: 'worker',
    userLevel: 5,
    fullName: 'Worker User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
    getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
  }
})

import { GET as getCoverage } from '@/app/api/purchase-requests/[id]/coverage/route'
import { GET as getPrs } from '@/app/api/purchase-requests/route'
import { authenticateRequest } from '@/lib/auth'

function coverageReq(id = 'pr-1') {
  return getCoverage(
    new NextRequest(`http://localhost/api/purchase-requests/${id}/coverage`),
    { params: Promise.resolve({ id }) },
  )
}

function listReq(query = '') {
  return getPrs(new NextRequest(`http://localhost/api/purchase-requests${query}`))
}

const MAT = { materialCode: 'M1', name: 'Thép tấm', unit: 'kg' }

/** PR APPROVED 2 dòng: mat-1 cần 10, mat-2 cần 5 */
const BASE_PR = {
  id: 'pr-1',
  prCode: 'PR-26-001',
  projectId: 'proj-1',
  requestedBy: 'user-1',
  status: 'APPROVED',
  urgency: 'NORMAL',
  notes: null,
  approvedBy: 'user-2',
  approvedAt: new Date(),
  originType: null,
  originId: null,
  originLabel: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [
    { id: 'pri-1', prId: 'pr-1', materialId: 'mat-1', quantity: 10, material: MAT },
    { id: 'pri-2', prId: 'pr-1', materialId: 'mat-2', quantity: 5, material: { ...MAT, materialCode: 'M2' } },
  ],
}

function poItem(materialId: string | null, quantity: number, projectId = 'proj-1') {
  return { materialId, quantity, purchaseOrder: { projectId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
})

describe('GET /api/purchase-requests/[id]/coverage', () => {
  it('phủ đủ — cộng dồn nhiều PO cùng materialId → fullyCovered, coveragePct 100', async () => {
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(BASE_PR as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      poItem('mat-1', 4), // 2 PO khác nhau cùng vật tư → cộng dồn 4 + 6 = 10
      poItem('mat-1', 6),
      poItem('mat-2', 8), // dư so với cần 5 → vẫn covered, shortage 0
    ] as never)

    const res = await coverageReq()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.prCode).toBe('PR-26-001')

    const mat1 = json.items.find((i: { materialId: string }) => i.materialId === 'mat-1')
    expect(mat1).toMatchObject({ needed: 10, covered: 10, shortage: 0, isCovered: true })
    const mat2 = json.items.find((i: { materialId: string }) => i.materialId === 'mat-2')
    expect(mat2).toMatchObject({ needed: 5, covered: 8, shortage: 0, isCovered: true })

    expect(json.summary).toMatchObject({
      totalItems: 2, coveredItems: 2, shortageItems: 0, coveragePct: 100, fullyCovered: true,
    })
  })

  it('thiếu — PO chỉ phủ 1 phần → shortage per-item + coveragePct đúng', async () => {
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(BASE_PR as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      poItem('mat-1', 4), // cần 10 → thiếu 6
      // mat-2 không có PO nào → thiếu 5
    ] as never)

    const res = await coverageReq()
    const json = await res.json()

    const mat1 = json.items.find((i: { materialId: string }) => i.materialId === 'mat-1')
    expect(mat1).toMatchObject({ needed: 10, covered: 4, shortage: 6, isCovered: false })
    const mat2 = json.items.find((i: { materialId: string }) => i.materialId === 'mat-2')
    expect(mat2).toMatchObject({ needed: 5, covered: 0, shortage: 5, isCovered: false })

    expect(json.summary).toMatchObject({
      totalItems: 2, coveredItems: 0, shortageItems: 2, coveragePct: 0, fullyCovered: false,
    })
  })

  it('1/2 dòng phủ đủ → coveragePct 50', async () => {
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(BASE_PR as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      poItem('mat-1', 10), // đủ
      poItem('mat-2', 3),  // thiếu 2
    ] as never)

    const res = await coverageReq()
    const json = await res.json()
    expect(json.summary).toMatchObject({ coveredItems: 1, coveragePct: 50, fullyCovered: false })
  })

  it('query PO loại DRAFT/CANCELLED/REJECTED + lọc đúng projectId/materialIds', async () => {
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(BASE_PR as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as never)

    await coverageReq()

    const call = prismaMock.purchaseOrderItem.findMany.mock.calls[0][0] as {
      where: {
        materialId: { in: string[] }
        purchaseOrder: { projectId: { in: string[] }; status: { notIn: string[] } }
      }
    }
    expect(call.where.materialId.in).toEqual(['mat-1', 'mat-2'])
    expect(call.where.purchaseOrder.projectId.in).toEqual(['proj-1'])
    expect(call.where.purchaseOrder.status.notIn).toEqual(
      expect.arrayContaining(['DRAFT', 'CANCELLED', 'REJECTED']),
    )
  })

  it('PO item materialId = null (snapshot không link vật tư) → bỏ qua, không cộng coverage', async () => {
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(BASE_PR as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      poItem(null, 999), // bị bỏ qua
      poItem('mat-1', 10),
    ] as never)

    const res = await coverageReq()
    const json = await res.json()

    const mat1 = json.items.find((i: { materialId: string }) => i.materialId === 'mat-1')
    expect(mat1.covered).toBe(10) // KHÔNG phải 1009
    const mat2 = json.items.find((i: { materialId: string }) => i.materialId === 'mat-2')
    expect(mat2).toMatchObject({ covered: 0, isCovered: false })
    expect(json.summary.fullyCovered).toBe(false)
  })

  it('PR không tồn tại → 404', async () => {
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(null)
    const res = await coverageReq('pr-x')
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })
})

describe('GET /api/purchase-requests?withCoverage=1 — list badge', () => {
  const SUBMITTED_PR = {
    ...BASE_PR,
    id: 'pr-2',
    prCode: 'PR-26-002',
    status: 'SUBMITTED',
    items: [{ id: 'pri-3', prId: 'pr-2', materialId: 'mat-9', quantity: 7, material: MAT }],
  }

  beforeEach(() => {
    prismaMock.purchaseRequest.count.mockResolvedValue(2)
    prismaMock.purchaseRequest.findMany.mockResolvedValue([
      { ...BASE_PR, project: { projectCode: 'PRJ-01', projectName: 'Du an 1' } },
      { ...SUBMITTED_PR, project: { projectCode: 'PRJ-01', projectName: 'Du an 1' } },
    ] as never)
  })

  it('withCoverage=1 → PR APPROVED có coverage summary, PR SUBMITTED coverage=null, shape cũ giữ nguyên', async () => {
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      poItem('mat-1', 10), // mat-2 thiếu → coveragePct 50
    ] as never)

    const res = await listReq('?withCoverage=1')
    expect(res.status).toBe(200)
    const json = await res.json()

    const approved = json.purchaseRequests.find((p: { id: string }) => p.id === 'pr-1')
    expect(approved.coverage).toMatchObject({
      totalItems: 2, coveredItems: 1, coveragePct: 50, fullyCovered: false,
    })
    const submitted = json.purchaseRequests.find((p: { id: string }) => p.id === 'pr-2')
    expect(submitted.coverage).toBeNull() // không tính cho PR chưa duyệt

    // Shape cũ không vỡ
    expect(approved.itemCount).toBe(2)
    expect(approved.totalItems).toBe(15)
    expect(json.pagination).toMatchObject({ page: 1, limit: 20, total: 2 })

    // Query gộp: chỉ 1 lần findMany PO item cho cả trang (tránh N+1)
    expect(prismaMock.purchaseOrderItem.findMany).toHaveBeenCalledTimes(1)
    const call = prismaMock.purchaseOrderItem.findMany.mock.calls[0][0] as {
      where: { materialId: { in: string[] } }
    }
    // Chỉ gom material của PR APPROVED (mat-9 của PR SUBMITTED không nằm trong query)
    expect(call.where.materialId.in).toEqual(['mat-1', 'mat-2'])
  })

  it('không có withCoverage → KHÔNG có field coverage, không query PO (backward compatible)', async () => {
    const res = await listReq()
    expect(res.status).toBe(200)
    const json = await res.json()

    for (const p of json.purchaseRequests) {
      expect(p).not.toHaveProperty('coverage')
    }
    expect(prismaMock.purchaseOrderItem.findMany).not.toHaveBeenCalled()
  })

  it('withCoverage=1 nhưng trang không có PR APPROVED → coverage=null, không query PO', async () => {
    prismaMock.purchaseRequest.count.mockResolvedValue(1)
    prismaMock.purchaseRequest.findMany.mockResolvedValue([
      { ...SUBMITTED_PR, project: { projectCode: 'PRJ-01', projectName: 'Du an 1' } },
    ] as never)

    const res = await listReq('?withCoverage=1')
    const json = await res.json()
    expect(json.purchaseRequests[0].coverage).toBeNull()
    expect(prismaMock.purchaseOrderItem.findMany).not.toHaveBeenCalled()
  })
})
