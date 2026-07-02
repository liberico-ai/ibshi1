/**
 * Tests cho /api/finance/settlement (Track B — quyết toán dự án)
 *
 * REFRESH tính đúng từ dữ liệu thật (mock), không đè bản SUBMITTED/APPROVED (409),
 * APPROVE/REJECT chỉ R01 (403), chuyển trạng thái đúng.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R08', // Finance — thuộc FINANCE_WRITE_ROLES
    username: 'ketoan',
    userLevel: 1,
    fullName: 'Ke Toan',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockAuthUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
    getClientIP: vi.fn().mockReturnValue('127.0.0.1'),
    getUserProjectIds: vi.fn().mockResolvedValue(null),
  }
})

import { GET, POST } from '@/app/api/finance/settlement/route'
import { authenticateRequest } from '@/lib/auth'

const PROJECT_ID = 'proj-stl-1'

function getReq(projectId = PROJECT_ID) {
  return new NextRequest(`http://localhost/api/finance/settlement?projectId=${projectId}`)
}

function postReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/finance/settlement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Mock đủ dữ liệu nguồn cho computeSettlement:
 *  - contractValue 10.000
 *  - AR: invoiced 8.000, collected 5.000
 *  - MATERIAL (GRN): 10 × 100 = 1.000
 *  - LABOR (khoán VERIFIED): 700
 *  - SERVICE (hóa đơn CHI không gắn PO): 500 (loại 800 gắn poId)
 *  - costOther (Budget OVERHEAD actual): 250
 *  → totalCost 2.450, profit 7.550, margin 75,5%
 */
function mockComputeData() {
  prismaMock.project.findUnique.mockResolvedValue({
    id: PROJECT_ID, projectCode: 'P-STL', contractValue: 10000,
  } as never)

  prismaMock.invoice.findMany.mockImplementation((async (args?: { where?: { type?: unknown } }) => {
    if (args?.where?.type === 'RECEIVABLE') {
      return [
        { totalAmount: 6000, paidAmount: 4000 },
        { totalAmount: 2000, paidAmount: 1000 },
      ]
    }
    // Hóa đơn CHI (type != RECEIVABLE) cho calcServiceActual
    return [
      { paidAmount: 500, poId: null, description: 'Thuê cẩu lắp dựng' },
      { paidAmount: 800, poId: 'po-1', description: null }, // gắn PO vật tư → loại
    ]
  }) as never)

  // MATERIAL qua GRN
  prismaMock.stockMovement.findMany.mockResolvedValue([
    { quantity: 10, poItemId: 'poi-1', materialId: 'mat-1' },
  ] as never)
  prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
    { id: 'poi-1', unitPrice: 100 },
  ] as never)
  prismaMock.material.findMany.mockResolvedValue([] as never)

  // LABOR khoán VERIFIED
  prismaMock.monthlyPieceRateOutput.findMany.mockResolvedValue([
    { totalAmount: 700 },
  ] as never)

  // Budget rows (planned/actual) — OVERHEAD actual 250 → costOther
  prismaMock.budget.findMany.mockResolvedValue([
    { category: 'MATERIAL', planned: 1200, actual: 1000, committed: 0 },
    { category: 'OVERHEAD', planned: 300, actual: 250, committed: 0 },
  ] as never)
}

const EXPECTED_NUMBERS = {
  revenueContract: 10000,
  revenueInvoiced: 8000,
  revenueCollected: 5000,
  costMaterial: 1000,
  costLabor: 700,
  costService: 500,
  costOther: 250,
  totalCost: 2450,
  profit: 7550,
  marginPct: 75.5,
}

const SAMPLE_SETTLEMENT = {
  id: 'stl-1',
  projectId: PROJECT_ID,
  ...EXPECTED_NUMBERS,
  status: 'DRAFT',
  snapshot: null,
  notes: null,
  createdBy: 'user-1',
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
})

describe('GET /api/finance/settlement', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })

  it('returns 400 when projectId missing', async () => {
    const res = await GET(new NextRequest('http://localhost/api/finance/settlement'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when project does not exist', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null)
    const res = await GET(getReq())
    expect(res.status).toBe(404)
  })

  it('returns settlement + live numbers for comparison', async () => {
    mockComputeData()
    prismaMock.projectSettlement.findUnique.mockResolvedValue(SAMPLE_SETTLEMENT as never)

    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.settlement).toMatchObject({ id: 'stl-1', status: 'DRAFT' })
    expect(json.live).toMatchObject(EXPECTED_NUMBERS)
    expect(json.budgets).toHaveLength(2)
  })
})

describe('POST /api/finance/settlement — REFRESH', () => {
  it('computes DRAFT settlement from real data sources', async () => {
    mockComputeData()
    prismaMock.projectSettlement.findUnique.mockResolvedValue(null)
    prismaMock.projectSettlement.upsert.mockImplementation((async (args: { create: Record<string, unknown> }) => ({
      ...SAMPLE_SETTLEMENT,
      ...args.create,
    })) as never)

    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'REFRESH' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.settlement).toMatchObject({ ...EXPECTED_NUMBERS, status: 'DRAFT' })

    // Upsert đúng số + status DRAFT + reset chữ ký duyệt
    const upsertArgs = prismaMock.projectSettlement.upsert.mock.calls[0][0] as {
      where: unknown; create: Record<string, unknown>; update: Record<string, unknown>
    }
    expect(upsertArgs.where).toEqual({ projectId: PROJECT_ID })
    expect(upsertArgs.update).toMatchObject({
      ...EXPECTED_NUMBERS,
      status: 'DRAFT',
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
    })
    expect(upsertArgs.create).toMatchObject({ projectId: PROJECT_ID, createdBy: 'user-1' })
  })

  it('returns 409 and does NOT overwrite an APPROVED settlement', async () => {
    prismaMock.projectSettlement.findUnique.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'APPROVED',
    } as never)

    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'REFRESH' }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(prismaMock.projectSettlement.upsert).not.toHaveBeenCalled()
  })

  it('returns 409 for SUBMITTED settlement too', async () => {
    prismaMock.projectSettlement.findUnique.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'SUBMITTED',
    } as never)

    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'REFRESH' }))
    expect(res.status).toBe(409)
    expect(prismaMock.projectSettlement.upsert).not.toHaveBeenCalled()
  })

  it('returns 403 when role is not in FINANCE_WRITE_ROLES', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R06' })
    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'REFRESH' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid action', async () => {
    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'DELETE' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/finance/settlement — SUBMIT / APPROVE / REJECT', () => {
  it('SUBMIT moves DRAFT → SUBMITTED', async () => {
    prismaMock.projectSettlement.findUnique.mockResolvedValue(SAMPLE_SETTLEMENT as never)
    prismaMock.projectSettlement.update.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'SUBMITTED', submittedAt: new Date(),
    } as never)

    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'SUBMIT' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.settlement.status).toBe('SUBMITTED')
    const call = prismaMock.projectSettlement.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data.status).toBe('SUBMITTED')
    expect(call.data.submittedAt).toBeInstanceOf(Date)
  })

  it('SUBMIT returns 409 when not DRAFT', async () => {
    prismaMock.projectSettlement.findUnique.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'SUBMITTED',
    } as never)
    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'SUBMIT' }))
    expect(res.status).toBe(409)
  })

  it('APPROVE with non-R01 role returns 403', async () => {
    // R08 thuộc FINANCE_WRITE_ROLES nhưng KHÔNG được duyệt
    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'APPROVE' }))
    expect(res.status).toBe(403)
    expect(prismaMock.projectSettlement.update).not.toHaveBeenCalled()
  })

  it('APPROVE by R01 moves SUBMITTED → APPROVED with approver signature', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R01', userId: 'giamdoc-1' })
    prismaMock.projectSettlement.findUnique.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'SUBMITTED',
    } as never)
    prismaMock.projectSettlement.update.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'APPROVED', approvedBy: 'giamdoc-1', approvedAt: new Date(),
    } as never)

    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'APPROVE' }))
    expect(res.status).toBe(200)
    const call = prismaMock.projectSettlement.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ status: 'APPROVED', approvedBy: 'giamdoc-1' })
  })

  it('APPROVE returns 409 when settlement is not SUBMITTED', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R01' })
    prismaMock.projectSettlement.findUnique.mockResolvedValue(SAMPLE_SETTLEMENT as never) // DRAFT
    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'APPROVE' }))
    expect(res.status).toBe(409)
  })

  it('REJECT by R01 moves SUBMITTED → REJECTED with reason in notes', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R01' })
    prismaMock.projectSettlement.findUnique.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'SUBMITTED',
    } as never)
    prismaMock.projectSettlement.update.mockResolvedValue({
      ...SAMPLE_SETTLEMENT, status: 'REJECTED', notes: 'Thiếu hóa đơn AR',
    } as never)

    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'REJECT', reason: 'Thiếu hóa đơn AR' }))
    expect(res.status).toBe(200)
    const call = prismaMock.projectSettlement.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ status: 'REJECTED', notes: 'Thiếu hóa đơn AR' })
  })

  it('SUBMIT returns 404 when settlement does not exist yet', async () => {
    prismaMock.projectSettlement.findUnique.mockResolvedValue(null)
    const res = await POST(postReq({ projectId: PROJECT_ID, action: 'SUBMIT' }))
    expect(res.status).toBe(404)
  })
})
