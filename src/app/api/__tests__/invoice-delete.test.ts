/**
 * Tests cho DELETE /api/finance/invoices/[id] (P2-đợt1-A3)
 *
 * Đường sửa sai duy nhất cho hóa đơn tạo nhầm — chỉ R01:
 * - 403 khi role khác R01
 * - 404 khi hóa đơn không tồn tại
 * - 409 khi paidAmount > 0 / có CustomerReceipt / Payment / DrawdownLine gắn hóa đơn
 * - 200 khi sạch: xóa + recalcBudgetActual(projectId) + logAudit
 * - Không có projectId → không gọi recalc
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R01',
    username: 'giamdoc',
    userLevel: 1,
    fullName: 'Giam Doc',
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

vi.mock('@/lib/sync-engine', () => ({
  recalcBudgetActual: vi.fn().mockResolvedValue(undefined),
}))

import { DELETE as deleteInvoice } from '@/app/api/finance/invoices/[id]/route'
import { authenticateRequest, logAudit } from '@/lib/auth'
import { recalcBudgetActual } from '@/lib/sync-engine'

const INVOICE_ID = 'inv-1'

function delReq() {
  return new NextRequest(`http://localhost/api/finance/invoices/${INVOICE_ID}`, { method: 'DELETE' })
}

function callDelete(id = INVOICE_ID) {
  return deleteInvoice(delReq(), { params: Promise.resolve({ id }) })
}

/** Hóa đơn sạch — không tiền, không chứng từ gắn vào */
function cleanInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoiceCode: 'INV-TEST-001',
    type: 'PAYABLE',
    projectId: 'proj-1',
    paidAmount: 0,
    totalAmount: 10000,
    _count: { receipts: 0, payments: 0, drawdownLines: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  prismaMock.invoice.delete.mockResolvedValue({ id: INVOICE_ID } as never)
})

describe('DELETE /api/finance/invoices/[id] — RBAC', () => {
  it('403 khi role khác R01 (kể cả R08 Finance / R10 Admin)', async () => {
    for (const roleCode of ['R08', 'R10', 'R02']) {
      vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode })
      const res = await callDelete()
      expect(res.status).toBe(403)
    }
    expect(prismaMock.invoice.delete).not.toHaveBeenCalled()
  })

  it('404 khi hóa đơn không tồn tại', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null)
    const res = await callDelete()
    expect(res.status).toBe(404)
    expect(prismaMock.invoice.delete).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/finance/invoices/[id] — chặn 409 khi có tiền/chứng từ', () => {
  it('409 khi paidAmount > 0, nêu rõ lý do', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(cleanInvoice({ paidAmount: 5000 }) as never)
    const res = await callDelete()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('paidAmount')
    expect(prismaMock.invoice.delete).not.toHaveBeenCalled()
    expect(recalcBudgetActual).not.toHaveBeenCalled()
  })

  it('409 khi có CustomerReceipt gắn hóa đơn', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(
      cleanInvoice({ _count: { receipts: 2, payments: 0, drawdownLines: 0 } }) as never)
    const res = await callDelete()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('phiếu thu')
    expect(prismaMock.invoice.delete).not.toHaveBeenCalled()
  })

  it('409 khi có Payment / DrawdownLine gắn hóa đơn', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(
      cleanInvoice({ _count: { receipts: 0, payments: 1, drawdownLines: 1 } }) as never)
    const res = await callDelete()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('thanh toán')
    expect(body.error).toContain('giải ngân')
    expect(prismaMock.invoice.delete).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/finance/invoices/[id] — xóa sạch', () => {
  it('200 khi hóa đơn sạch: xóa + recalcBudgetActual(projectId) + logAudit', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(cleanInvoice() as never)
    const res = await callDelete()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.deleted).toBe(true)
    expect(prismaMock.invoice.delete).toHaveBeenCalledWith({ where: { id: INVOICE_ID } })
    expect(recalcBudgetActual).toHaveBeenCalledWith('proj-1', 'user-1')
    expect(logAudit).toHaveBeenCalledWith(
      'user-1', 'INVOICE_DELETE', 'Invoice', INVOICE_ID,
      expect.objectContaining({ invoiceCode: 'INV-TEST-001' }),
      '127.0.0.1',
    )
  })

  it('không có projectId → xóa OK nhưng KHÔNG gọi recalc', async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(cleanInvoice({ projectId: null }) as never)
    const res = await callDelete()
    expect(res.status).toBe(200)
    expect(prismaMock.invoice.delete).toHaveBeenCalled()
    expect(recalcBudgetActual).not.toHaveBeenCalled()
  })
})
