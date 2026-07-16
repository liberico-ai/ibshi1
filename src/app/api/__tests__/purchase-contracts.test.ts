/**
 * Route tests for T1 — Hợp đồng mua (PurchaseContract).
 * POST create + GET list + PATCH + link-po + RBAC 403. Prisma deep-mocked; auth mocked.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const mockAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    authenticateRequest: (...a: unknown[]) => mockAuth(...a),
    getUserProjectIds: vi.fn().mockResolvedValue(null), // R01/R07 see all
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

import { GET, POST } from '@/app/api/projects/[id]/purchase-contracts/route'
import { PATCH } from '@/app/api/purchase-contracts/[id]/route'
import { POST as LINK_PO } from '@/app/api/purchase-contracts/[id]/link-po/route'

const R07 = { userId: 'u7', username: 'tm', roleCode: 'R07', userLevel: 2, fullName: 'Thương mại' }
const R05 = { userId: 'u5', username: 'kho', roleCode: 'R05', userLevel: 2, fullName: 'Kho' }
const PROJECT_ID = 'proj_1'
const params = Promise.resolve({ id: PROJECT_ID })

function postReq(url: string, payload: unknown) {
  return new NextRequest(url, {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  mockAuth.mockResolvedValue(R07)
  prismaMock.project.findUnique.mockResolvedValue({ id: PROJECT_ID, projectCode: 'I-095', projectName: 'VPI' } as never)
  prismaMock.vendor.findUnique.mockResolvedValue({ id: 'vend_hh' } as never)
  prismaMock.purchaseContract.findUnique.mockResolvedValue(null as never) // no dup by default
})

// ── GET list ──
describe('GET /api/projects/[id]/purchase-contracts', () => {
  it('trả danh sách + tính tổng PO đã gắn + cảnh báo vượt giá trị', async () => {
    prismaMock.purchaseContract.findMany.mockResolvedValue([
      {
        id: 'c1', contractCode: 'HDMB-2025-HH-095', contractType: 'HDMB', title: 'HĐ Hoàng Hà',
        value: 1000, currency: 'VND', status: 'ACTIVE', signedDate: null, effectiveDate: null,
        paymentTerms: null, deliveryTerms: null, signedFileId: null, notes: null, projectId: PROJECT_ID,
        vendorId: 'vend_hh', createdBy: 'u7', createdAt: new Date(), updatedAt: new Date(),
        vendor: { id: 'vend_hh', vendorCode: 'HH', name: 'Hoàng Hà' },
        orders: [{ id: 'po1', poCode: 'PO-00001', totalValue: 1500, status: 'APPROVED' }],
      },
    ] as never)

    const res = await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/purchase-contracts`), { params })
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.contracts).toHaveLength(1)
    expect(body.contracts[0].linkedPoTotal).toBe(1500)
    expect(body.contracts[0].linkedPoCount).toBe(1)
    expect(body.contracts[0].overBudget).toBe(true) // 1500 > 1000
    expect(body.canWrite).toBe(true)
  })

  it('403 khi role không có quyền xem (R05 Kho)', async () => {
    mockAuth.mockResolvedValue(R05)
    const res = await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/purchase-contracts`), { params })
    expect(res.status).toBe(403)
  })

  it('401 khi chưa đăng nhập', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/purchase-contracts`), { params })
    expect(res.status).toBe(401)
  })
})

// ── POST create ──
describe('POST /api/projects/[id]/purchase-contracts', () => {
  const url = `http://localhost/api/projects/${PROJECT_ID}/purchase-contracts`

  it('tạo hợp đồng hợp lệ', async () => {
    prismaMock.purchaseContract.create.mockResolvedValue({ id: 'c1', contractCode: 'HDMB-2025-HH-095' } as never)
    const res = await POST(postReq(url, {
      contractCode: 'HDMB-2025-HH-095', contractType: 'HDMB', vendorId: 'vend_hh', title: 'HĐ Hoàng Hà', value: 1500000000,
    }), { params })
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(prismaMock.purchaseContract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectId: PROJECT_ID, contractCode: 'HDMB-2025-HH-095', contractType: 'HDMB', vendorId: 'vend_hh', createdBy: 'u7' }),
      }),
    )
  })

  it('403 khi role ngoài R07/R01 (R05 Kho)', async () => {
    mockAuth.mockResolvedValue(R05)
    const res = await POST(postReq(url, { contractCode: 'X', vendorId: 'vend_hh', title: 'x' }), { params })
    expect(res.status).toBe(403)
    expect(prismaMock.purchaseContract.create).not.toHaveBeenCalled()
  })

  it('400 khi thiếu contractCode', async () => {
    const res = await POST(postReq(url, { vendorId: 'vend_hh', title: 'x' }), { params })
    expect(res.status).toBe(400)
  })

  it('400 khi contractType không hợp lệ', async () => {
    const res = await POST(postReq(url, { contractCode: 'X', contractType: 'INVALID', vendorId: 'vend_hh', title: 'x' }), { params })
    expect(res.status).toBe(400)
    expect(prismaMock.purchaseContract.create).not.toHaveBeenCalled()
  })

  it('409 khi số HĐ đã tồn tại', async () => {
    prismaMock.purchaseContract.findUnique.mockResolvedValue({ id: 'dup' } as never)
    const res = await POST(postReq(url, { contractCode: 'HDMB-2025-HH-095', vendorId: 'vend_hh', title: 'x' }), { params })
    expect(res.status).toBe(409)
    expect(prismaMock.purchaseContract.create).not.toHaveBeenCalled()
  })

  it('400 khi vendor không tồn tại', async () => {
    prismaMock.vendor.findUnique.mockResolvedValue(null as never)
    const res = await POST(postReq(url, { contractCode: 'X', vendorId: 'nope', title: 'x' }), { params })
    expect(res.status).toBe(400)
  })
})

// ── PATCH update ──
describe('PATCH /api/purchase-contracts/[id]', () => {
  const cid = Promise.resolve({ id: 'c1' })
  beforeEach(() => {
    prismaMock.purchaseContract.findUnique.mockResolvedValue({ id: 'c1' } as never)
  })

  it('cập nhật trạng thái sang ACTIVE', async () => {
    prismaMock.purchaseContract.update.mockResolvedValue({ id: 'c1', status: 'ACTIVE' } as never)
    const res = await PATCH(postReq('http://localhost/api/purchase-contracts/c1', { status: 'ACTIVE' }), { params: cid })
    expect(res.status).toBe(200)
    expect(prismaMock.purchaseContract.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ status: 'ACTIVE' }) }),
    )
  })

  it('400 khi status không hợp lệ', async () => {
    const res = await PATCH(postReq('http://localhost/api/purchase-contracts/c1', { status: 'BAD' }), { params: cid })
    expect(res.status).toBe(400)
  })

  it('403 role ngoài R07/R01', async () => {
    mockAuth.mockResolvedValue(R05)
    const res = await PATCH(postReq('http://localhost/api/purchase-contracts/c1', { status: 'ACTIVE' }), { params: cid })
    expect(res.status).toBe(403)
  })
})

// ── link-po ──
describe('POST /api/purchase-contracts/[id]/link-po', () => {
  const cid = Promise.resolve({ id: 'c1' })

  it('gắn PO thành công (set contractId)', async () => {
    prismaMock.purchaseContract.findUnique.mockResolvedValue({ id: 'c1', projectId: PROJECT_ID, vendorId: 'vend_hh' } as never)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({ id: 'po1', poCode: 'PO-00001', projectId: PROJECT_ID, vendorId: 'vend_hh', contractId: null } as never)
    prismaMock.purchaseOrder.update.mockResolvedValue({ id: 'po1', contractId: 'c1' } as never)

    const res = await LINK_PO(postReq('http://localhost/api/purchase-contracts/c1/link-po', { poId: 'po1' }), { params: cid })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(prismaMock.purchaseOrder.update).toHaveBeenCalledWith({ where: { id: 'po1' }, data: { contractId: 'c1' } })
  })

  it('409 khi PO đã thuộc HĐ khác', async () => {
    prismaMock.purchaseContract.findUnique.mockResolvedValue({ id: 'c1', projectId: PROJECT_ID, vendorId: 'vend_hh' } as never)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({ id: 'po1', poCode: 'PO-00001', projectId: PROJECT_ID, vendorId: 'vend_hh', contractId: 'other' } as never)
    const res = await LINK_PO(postReq('http://localhost/api/purchase-contracts/c1/link-po', { poId: 'po1' }), { params: cid })
    expect(res.status).toBe(409)
    expect(prismaMock.purchaseOrder.update).not.toHaveBeenCalled()
  })

  it('400 khi PO khác NCC với HĐ', async () => {
    prismaMock.purchaseContract.findUnique.mockResolvedValue({ id: 'c1', projectId: PROJECT_ID, vendorId: 'vend_hh' } as never)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({ id: 'po1', poCode: 'PO-00001', projectId: PROJECT_ID, vendorId: 'vend_other', contractId: null } as never)
    const res = await LINK_PO(postReq('http://localhost/api/purchase-contracts/c1/link-po', { poId: 'po1' }), { params: cid })
    expect(res.status).toBe(400)
  })

  it('403 role ngoài R07/R01', async () => {
    mockAuth.mockResolvedValue(R05)
    const res = await LINK_PO(postReq('http://localhost/api/purchase-contracts/c1/link-po', { poId: 'po1' }), { params: cid })
    expect(res.status).toBe(403)
  })
})
