/**
 * PO-Gate (Đợt 1B): PO tạo từ P3.6 (request_payment) phải qua duyệt R01/R07.
 * - request_payment tạo PO → status PENDING + notify R01/R07
 * - GRN với PO PENDING → 422; PO APPROVED trở đi → nhận hàng OK
 * - Thanh toán (payments) với hóa đơn gắn PO PENDING → 422
 * - Giải ngân (drawdown) chọn PO PENDING → 422
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    userId: 'user-1',
    roleCode: 'R07',
    username: 'commercial',
    userLevel: 2,
    fullName: 'Commercial User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockUser),
    logAudit: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/stock-ledger', () => ({
  applyStockMovement: vi.fn().mockResolvedValue({ id: 'mv-1' }),
}))

vi.mock('@/lib/sync-engine', () => ({
  recalcBudgetActual: vi.fn().mockResolvedValue(undefined),
  recalcPOTotal: vi.fn().mockResolvedValue(0),
  syncPOtoBudget: vi.fn().mockResolvedValue(undefined),
}))

import { PUT as procurementPUT } from '@/app/api/procurement-tracking/route'
import { POST as grnPOST } from '@/app/api/grn/route'
import { POST as paymentPOST } from '@/app/api/finance/payments/route'
import { POST as drawdownPOST } from '@/app/api/finance/payments/drawdown/route'
import { authenticateRequest } from '@/lib/auth'

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('PO-Gate: request_payment (P3.6) tạo PO PENDING', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R07' })
  })

  it('PO mới từ request_payment có status PENDING và notify R01/R07', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-1',
      projectId: 'proj-1',
      resultData: {
        groups: [{
          id: 'g1',
          prCode: 'PR-TEST-01',
          assignedSupplier: 'NCC Thép A',
          totalValue: 500000,
          items: [],
        }],
      },
    } as any)
    prismaMock.vendor.findFirst.mockResolvedValue({ id: 'ven-1', name: 'NCC Thép A' } as any)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue(null)
    prismaMock.purchaseOrder.create.mockResolvedValue({ id: 'po-new', poCode: 'PR-TEST-01' } as any)
    // user.findMany gọi 2 lần: (1) approvers R01/R07, (2) accountants R08/R08a
    prismaMock.user.findMany
      .mockResolvedValueOnce([{ id: 'boss-1' }] as any)
      .mockResolvedValueOnce([{ id: 'acct-1' }] as any)
    prismaMock.notification.createMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.task.update.mockResolvedValue({} as any)

    const res = await procurementPUT(jsonReq('http://localhost/api/procurement-tracking', 'PUT', {
      taskId: 'task-1', groupId: 'g1', action: 'request_payment',
    }) as any)

    expect(res.status).toBe(200)
    // PO tạo ra phải PENDING (không phải APPROVED)
    expect(prismaMock.purchaseOrder.create).toHaveBeenCalledTimes(1)
    const createArg = prismaMock.purchaseOrder.create.mock.calls[0][0] as any
    expect(createArg.data.status).toBe('PENDING')

    // Notify R01/R07 "PO chờ duyệt"
    expect(prismaMock.user.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ roleCode: { in: ['R01', 'R07'] } }),
    }))
    const firstNotify = prismaMock.notification.createMany.mock.calls[0][0] as any
    expect(firstNotify.data[0].title).toContain('PO chờ duyệt')

    // Kế toán vẫn được báo nhưng message nêu rõ chờ duyệt PO
    const secondNotify = prismaMock.notification.createMany.mock.calls[1][0] as any
    expect(secondNotify.data[0].message).toContain('chờ R01/R07 duyệt')
  })

  it('PO đã tồn tại (legacy APPROVED) — không tạo PO mới, không đổi status', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-1',
      projectId: 'proj-1',
      resultData: { groups: [{ id: 'g1', prCode: 'PR-OLD-01', assignedSupplier: 'NCC B', totalValue: 100, items: [] }] },
    } as any)
    prismaMock.vendor.findFirst.mockResolvedValue({ id: 'ven-1', name: 'NCC B' } as any)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po-old', poCode: 'PR-OLD-01', status: 'APPROVED', projectId: 'proj-1', items: [{ id: 'poi-1' }],
    } as any)
    prismaMock.user.findMany.mockResolvedValue([] as any)
    prismaMock.task.update.mockResolvedValue({} as any)

    const res = await procurementPUT(jsonReq('http://localhost/api/procurement-tracking', 'PUT', {
      taskId: 'task-1', groupId: 'g1', action: 'request_payment',
    }) as any)

    expect(res.status).toBe(200)
    expect(prismaMock.purchaseOrder.create).not.toHaveBeenCalled()
    // Không update status của PO legacy (B4: data cũ giữ nguyên)
    const updateCalls = prismaMock.purchaseOrder.update.mock.calls
    for (const c of updateCalls) {
      expect((c[0] as any).data.status).toBeUndefined()
    }
  })
})

describe('PO-Gate: GRN chặn PO chưa duyệt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R05' })
  })

  const grnBody = {
    poId: 'po-1',
    items: [{ poItemId: 'poi-1', receivedQty: 5 }],
  }

  it.each(['PENDING', 'DRAFT', 'REJECTED'])('PO %s → 422', async (status) => {
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po-1', poCode: 'PR-TEST-01', status, vendorId: 'ven-1', items: [],
    } as any)

    const res = await grnPOST(jsonReq('http://localhost/api/grn', 'POST', grnBody) as any)
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('chưa được duyệt')
  })

  it('PO APPROVED → nhận hàng OK', async () => {
    const poItem = {
      id: 'poi-1', materialId: 'mat-1', quantity: 10, receivedQty: 0,
      material: { id: 'mat-1', materialCode: 'ST-001', name: 'Thép', unit: 'kg' },
    }
    prismaMock.purchaseOrder.findUnique
      .mockResolvedValueOnce({
        id: 'po-1', poCode: 'PR-TEST-01', status: 'APPROVED', vendorId: 'ven-1', projectId: 'proj-1',
        items: [poItem],
      } as any)
      // lần 2 (trong transaction): check allReceived
      .mockResolvedValueOnce({
        id: 'po-1', items: [{ ...poItem, receivedQty: 5 }],
      } as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.purchaseOrderItem.update.mockResolvedValue({} as any)
    prismaMock.purchaseOrder.update.mockResolvedValue({} as any)

    const res = await grnPOST(jsonReq('http://localhost/api/grn', 'POST', grnBody) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.poStatus).toBe('PARTIAL_RECEIVED')
  })
})

describe('PO-Gate: thanh toán chặn hóa đơn gắn PO chưa duyệt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R08' })
  })

  it('invoice gắn PO PENDING → 422', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1', poId: 'po-1', type: 'ADVANCE_PAYMENT',
      totalAmount: 1000, paidAmount: 0, invoiceCode: 'INV-1', projectId: 'proj-1',
    } as any)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({ poCode: 'PR-TEST-01', status: 'PENDING' } as any)

    const res = await paymentPOST(jsonReq('http://localhost/api/finance/payments', 'POST', {
      invoiceId: 'inv-1', amount: 500, paymentDate: '2026-07-02',
    }) as any)

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('chưa được duyệt')
    expect(prismaMock.payment.create).not.toHaveBeenCalled()
  })

  it('invoice gắn PO APPROVED → thanh toán OK', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 'inv-1', poId: 'po-1', type: 'ADVANCE_PAYMENT',
      totalAmount: 1000, paidAmount: 0, invoiceCode: 'INV-1', projectId: 'proj-1',
    } as any)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({ poCode: 'PR-TEST-01', status: 'APPROVED' } as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1' } as any)
    prismaMock.invoice.update.mockResolvedValue({} as any)
    prismaMock.cashflowEntry.create.mockResolvedValue({} as any)

    const res = await paymentPOST(jsonReq('http://localhost/api/finance/payments', 'POST', {
      invoiceId: 'inv-1', amount: 500, paymentDate: '2026-07-02',
    }) as any)

    expect(res.status).toBe(200)
    expect(prismaMock.payment.create).toHaveBeenCalled()
  })
})

describe('PO-Gate: giải ngân (drawdown) chặn PO chưa duyệt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockUser, roleCode: 'R08' })
  })

  it('chọn PO PENDING → 422', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { poCode: 'PR-TEST-01', status: 'PENDING' },
    ] as any)

    const res = await drawdownPOST(jsonReq('http://localhost/api/finance/payments/drawdown', 'POST', {
      contractId: 'contract-1',
      invoices: [{ id: 'po-1', poCode: 'PR-TEST-01', totalAmount: 1000, vendorName: 'NCC A' }],
    }) as any)

    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('chưa được duyệt')
    expect(prismaMock.loanDrawdown.create).not.toHaveBeenCalled()
  })
})
