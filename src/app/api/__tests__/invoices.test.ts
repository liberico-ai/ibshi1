/**
 * Tests cho POST /api/finance/invoices (P2-2 — tôn trọng taxRate client)
 *
 * Bug gốc: `Number(taxRate || 10)` — taxRate 0 là falsy → bị ép về VAT 10% mặc định.
 * - taxRate 0 → taxAmount 0, totalAmount = amount
 * - taxRate 8 → tính đúng
 * - Không gửi taxRate → default 10% (backward compatible)
 * - totalAmount client gửi lệch amount + taxAmount quá 1đ → 400
 * - totalAmount khớp → giữ nguyên giá trị client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockAuthUser } = vi.hoisted(() => ({
  mockAuthUser: {
    userId: 'user-1',
    roleCode: 'R01', // BGĐ — được tạo hóa đơn
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
    getUserProjectIds: vi.fn().mockResolvedValue(null),
  }
})

import { POST as postInvoice } from '@/app/api/finance/invoices/route'
import { authenticateRequest } from '@/lib/auth'

function invoiceReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/finance/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createData() {
  return prismaMock.invoice.create.mock.calls[0][0].data as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  prismaMock.invoice.create.mockImplementation((({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'inv-1', ...data })) as never)
})

describe('POST /api/finance/invoices — taxRate', () => {
  it('taxRate 0 → taxAmount 0, totalAmount = amount (không bị ép về 10%)', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-001', type: 'RECEIVABLE', amount: 10000, taxRate: 0, totalAmount: 10000,
    }))
    expect(res.status).toBe(201)

    expect(createData()).toMatchObject({
      amount: 10000, taxRate: 0, taxAmount: 0, totalAmount: 10000,
    })
  })

  it('taxRate 8 → taxAmount = round(amount × 8%), totalAmount đúng', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-002', type: 'PAYABLE', amount: 10000, taxRate: 8,
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({
      amount: 10000, taxRate: 8, taxAmount: 800, totalAmount: 10800,
    })
  })

  it('không gửi taxRate → default 10% (backward compatible)', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-003', type: 'RECEIVABLE', amount: 10000,
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({
      taxRate: 10, taxAmount: 1000, totalAmount: 11000,
    })
  })

  it('taxRate "" (form rỗng) → default 10%', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-004', type: 'RECEIVABLE', amount: 10000, taxRate: '',
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({ taxRate: 10, taxAmount: 1000, totalAmount: 11000 })
  })

  it('taxRate "0" (string từ form cũ) → 0%, không ép về 10%', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-005', type: 'RECEIVABLE', amount: 10000, taxRate: '0',
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({ taxRate: 0, taxAmount: 0, totalAmount: 10000 })
  })

  it('taxRate ngoài khoảng 0–100 → 400', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-006', type: 'RECEIVABLE', amount: 10000, taxRate: 120,
    }))
    expect(res.status).toBe(400)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/finance/invoices — totalAmount consistency', () => {
  it('totalAmount mâu thuẫn với amount + taxAmount (lệch > 1đ) → 400, không tạo', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-010', type: 'RECEIVABLE', amount: 10000, taxRate: 10, totalAmount: 10000,
    }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('không khớp')
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it('totalAmount khớp → giữ nguyên giá trị client', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-011', type: 'RECEIVABLE', amount: 10000, taxRate: 10, totalAmount: 11000,
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({ taxRate: 10, taxAmount: 1000, totalAmount: 11000 })
  })

  it('totalAmount lệch trong dung sai 1đ (làm tròn) → chấp nhận, giữ giá trị client', async () => {
    // amount 1005, taxRate 0.5% → taxAmount round(5.025) = 5, expected 1010; client gửi 1011 (lệch 1đ)
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-012', type: 'RECEIVABLE', amount: 1005, taxRate: 0.5, totalAmount: 1011,
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({ taxAmount: 5, totalAmount: 1011 })
  })

  it('client gửi cả taxAmount → dùng taxAmount client thay vì tính lại', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-013', type: 'PAYABLE', amount: 10000, taxRate: 10, taxAmount: 999, totalAmount: 10999,
    }))
    expect(res.status).toBe(201)
    expect(createData()).toMatchObject({ taxRate: 10, taxAmount: 999, totalAmount: 10999 })
  })
})

describe('POST /api/finance/invoices — guard cơ bản', () => {
  it('sai role (không phải R01/R02) → 403', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R08' })
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-020', type: 'RECEIVABLE', amount: 10000,
    }))
    expect(res.status).toBe(403)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it('amount không hợp lệ (NaN) → 400', async () => {
    const res = await postInvoice(invoiceReq({
      invoiceCode: 'INV-021', type: 'RECEIVABLE', amount: 'abc',
    }))
    expect(res.status).toBe(400)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })
})
