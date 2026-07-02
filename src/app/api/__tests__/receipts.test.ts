/**
 * Tests cho /api/finance/receipts (Đợt 1C — thu tiền khách traceable)
 *
 * - 2 receipt cộng dồn: paidAmount = Σ receipts (recompute, không +=)
 * - Vượt totalAmount → 409
 * - Sai role → 403
 * - DELETE (chỉ R01) recompute lại paidAmount + xóa CashflowEntry
 * - /api/finance/payments cho hóa đơn RECEIVABLE → 422 (chặn đường cũ)
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

import { POST as postReceipt, GET as getReceipts } from '@/app/api/finance/receipts/route'
import { DELETE as deleteReceipt } from '@/app/api/finance/receipts/[id]/route'
import { POST as postPayment } from '@/app/api/finance/payments/route'
import { authenticateRequest } from '@/lib/auth'

const INVOICE = {
  id: 'inv-1',
  invoiceCode: 'INV-001',
  type: 'RECEIVABLE',
  projectId: 'proj-1',
  poId: null,
  totalAmount: 1000,
  paidAmount: 0,
  status: 'SENT',
}

function receiptReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/finance/receipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function paymentReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/finance/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq(id: string) {
  return deleteReceipt(
    new NextRequest(`http://localhost/api/finance/receipts/${id}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id }) },
  )
}

/** $transaction(fn) → chạy fn với chính prismaMock làm tx */
function mockTransaction() {
  prismaMock.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)) as never)
}

function mockCreatedReceipt(id: string, amount: number) {
  prismaMock.customerReceipt.create.mockResolvedValue({
    id, invoiceId: INVOICE.id, projectId: INVOICE.projectId, amount,
    method: 'BANK', receivedAt: new Date(), referenceNo: null, notes: null,
    createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(),
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  mockTransaction()
})

describe('POST /api/finance/receipts', () => {
  it('2 receipts cộng dồn: paidAmount = Σ receipts (recompute, không +=)', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE } as never)

    // ── Receipt 1: chưa có receipt nào, thu 400 → paidAmount 400, PARTIAL
    prismaMock.customerReceipt.aggregate.mockResolvedValue({ _sum: { amount: null } } as never)
    mockCreatedReceipt('rcp-1', 400)

    const res1 = await postReceipt(receiptReq({ invoiceId: 'inv-1', amount: 400, method: 'BANK' }))
    expect(res1.status).toBe(200)
    const json1 = await res1.json()
    expect(json1.ok).toBe(true)
    expect(json1.receipt.amount).toBe(400)

    let updateCall = prismaMock.invoice.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(updateCall.where).toEqual({ id: 'inv-1' })
    expect(updateCall.data).toMatchObject({ paidAmount: 400, status: 'PARTIAL' })

    // CashflowEntry INFLOW idempotent theo entryCode CF-RCP-<id>
    const cfCall = prismaMock.cashflowEntry.upsert.mock.calls[0][0] as {
      where: { entryCode: string }; create: Record<string, unknown>
    }
    expect(cfCall.where.entryCode).toBe('CF-RCP-rcp-1')
    expect(cfCall.create).toMatchObject({
      type: 'INFLOW', category: 'CUSTOMER_RECEIPT', amount: 400, projectId: 'proj-1',
    })

    // ── Receipt 2: DB đã có Σ 400 (dù invoice.paidAmount mock vẫn 0 — chứng minh recompute), thu 600 → 1000, PAID
    prismaMock.customerReceipt.aggregate.mockResolvedValue({ _sum: { amount: 400 } } as never)
    mockCreatedReceipt('rcp-2', 600)

    const res2 = await postReceipt(receiptReq({ invoiceId: 'inv-1', amount: 600, method: 'CASH' }))
    expect(res2.status).toBe(200)

    updateCall = prismaMock.invoice.update.mock.calls[1][0] as { where: unknown; data: Record<string, unknown> }
    expect(updateCall.data).toMatchObject({ paidAmount: 1000, status: 'PAID' })
  })

  it('Σ(receipts) + amount vượt totalAmount → 409, không tạo receipt', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE } as never)
    prismaMock.customerReceipt.aggregate.mockResolvedValue({ _sum: { amount: 400 } } as never)

    const res = await postReceipt(receiptReq({ invoiceId: 'inv-1', amount: 700 }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(prismaMock.customerReceipt.create).not.toHaveBeenCalled()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('sai role (không thuộc FINANCE_WRITE_ROLES) → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R06' })
    const res = await postReceipt(receiptReq({ invoiceId: 'inv-1', amount: 100 }))
    expect(res.status).toBe(403)
    expect(prismaMock.customerReceipt.create).not.toHaveBeenCalled()
  })

  it('hóa đơn không phải RECEIVABLE → 422', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE, type: 'PAYABLE' } as never)
    const res = await postReceipt(receiptReq({ invoiceId: 'inv-1', amount: 100 }))
    expect(res.status).toBe(422)
    expect(prismaMock.customerReceipt.create).not.toHaveBeenCalled()
  })
})

describe('GET /api/finance/receipts', () => {
  it('lọc theo invoiceId', async () => {
    prismaMock.customerReceipt.findMany.mockResolvedValue([
      {
        id: 'rcp-1', invoiceId: 'inv-1', projectId: 'proj-1', amount: 400,
        method: 'BANK', receivedAt: new Date(), referenceNo: 'UNC-01', notes: null,
        createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(),
        invoice: { invoiceCode: 'INV-001', clientName: 'KH A', totalAmount: 1000, paidAmount: 400 },
      },
    ] as never)

    const res = await getReceipts(new NextRequest('http://localhost/api/finance/receipts?invoiceId=inv-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.receipts).toHaveLength(1)
    expect(json.receipts[0].amount).toBe(400)
    const findCall = prismaMock.customerReceipt.findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(findCall.where).toEqual({ invoiceId: 'inv-1' })
  })
})

describe('DELETE /api/finance/receipts/[id]', () => {
  const RECEIPT = {
    id: 'rcp-1', invoiceId: 'inv-1', projectId: 'proj-1', amount: 600,
    method: 'BANK', receivedAt: new Date(), referenceNo: null, notes: null,
    createdBy: 'user-1', createdAt: new Date(), updatedAt: new Date(),
  }

  it('không phải R01 → 403', async () => {
    const res = await deleteReq('rcp-1') // R08
    expect(res.status).toBe(403)
    expect(prismaMock.customerReceipt.delete).not.toHaveBeenCalled()
  })

  it('R01 xóa receipt → recompute paidAmount từ receipts còn lại + xóa CashflowEntry', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R01', userId: 'giamdoc-1' })
    prismaMock.customerReceipt.findUnique.mockResolvedValue(RECEIPT as never)
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE, paidAmount: 1000, status: 'PAID' } as never)
    // Sau khi xóa còn lại Σ 400
    prismaMock.customerReceipt.aggregate.mockResolvedValue({ _sum: { amount: 400 } } as never)

    const res = await deleteReq('rcp-1')
    expect(res.status).toBe(200)

    expect(prismaMock.customerReceipt.delete).toHaveBeenCalledWith({ where: { id: 'rcp-1' } })
    expect(prismaMock.cashflowEntry.deleteMany).toHaveBeenCalledWith({ where: { entryCode: 'CF-RCP-rcp-1' } })

    const updateCall = prismaMock.invoice.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> }
    expect(updateCall.where).toEqual({ id: 'inv-1' })
    expect(updateCall.data).toMatchObject({ paidAmount: 400, status: 'PARTIAL' })
  })

  it('xóa receipt cuối cùng → paidAmount 0, status về SENT', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R01' })
    prismaMock.customerReceipt.findUnique.mockResolvedValue(RECEIPT as never)
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE, paidAmount: 600, status: 'PARTIAL' } as never)
    prismaMock.customerReceipt.aggregate.mockResolvedValue({ _sum: { amount: null } } as never)

    const res = await deleteReq('rcp-1')
    expect(res.status).toBe(200)
    const updateCall = prismaMock.invoice.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(updateCall.data).toMatchObject({ paidAmount: 0, status: 'SENT' })
  })

  it('receipt không tồn tại → 404', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R01' })
    prismaMock.customerReceipt.findUnique.mockResolvedValue(null)
    const res = await deleteReq('rcp-x')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/finance/payments — chặn đường cũ cho RECEIVABLE', () => {
  it('payment cho hóa đơn RECEIVABLE → 422 "Dùng phiếu thu"', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...INVOICE } as never)

    const res = await postPayment(paymentReq({
      invoiceId: 'inv-1', amount: 100, paymentDate: '2026-07-02', method: 'BANK_TRANSFER',
    }))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.error).toContain('phiếu thu')
    expect(prismaMock.payment.create).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('payment cho hóa đơn PAYABLE vẫn hoạt động bình thường', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...INVOICE, type: 'PAYABLE', poId: null,
    } as never)
    prismaMock.payment.create.mockResolvedValue({ id: 'pay-1', invoiceId: 'inv-1', amount: 100 } as never)

    const res = await postPayment(paymentReq({
      invoiceId: 'inv-1', amount: 100, paymentDate: '2026-07-02', method: 'BANK_TRANSFER',
    }))
    expect(res.status).toBe(200)
    expect(prismaMock.payment.create).toHaveBeenCalled()
  })
})
