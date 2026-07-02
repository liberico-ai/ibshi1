/**
 * Tests cho PATCH /api/hr/piece-rate-output (P2-đợt1-A4)
 *
 * VERIFY (nghiệm thu):
 * - Đơn giá HĐ khoán đã đổi sau khi nhập KL → re-calc totalAmount = quantity × đơn giá
 *   HIỆN TẠI, ghi đè khi nghiệm thu + console.warn
 * - Đơn giá khớp → không ghi đè totalAmount/unitPrice
 * - Đã VERIFIED → idempotent, không update lại
 * UNVERIFY (hủy nghiệm thu, VERIFIED → DRAFT):
 * - Chỉ R01/R10 — role khác (kể cả R02/R08 vốn được VERIFY) → 403
 * - Đúng role → status DRAFT, verifiedBy null + recalcBudgetActual
 * - Output đang DRAFT → idempotent, không update
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

import { PATCH as patchOutput } from '@/app/api/hr/piece-rate-output/route'
import { authenticateRequest } from '@/lib/auth'
import { recalcBudgetActual } from '@/lib/sync-engine'

const OUTPUT_ID = 'out-1'

function patchReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/hr/piece-rate-output', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** KL khoán DRAFT: 10 tấn × 100k = 1.000k, đơn giá HĐ hiện tại truyền qua overrides */
function draftOutput(overrides: Record<string, unknown> = {}, contractUnitPrice = 100_000) {
  return {
    id: OUTPUT_ID,
    contractId: 'ct-1',
    month: 6,
    year: 2026,
    quantity: 10,
    unitPrice: 100_000,
    totalAmount: 1_000_000,
    status: 'DRAFT',
    verifiedBy: null,
    contract: { projectId: 'proj-1', unitPrice: contractUnitPrice },
    ...overrides,
  }
}

function updateData() {
  return prismaMock.monthlyPieceRateOutput.update.mock.calls[0][0].data as Record<string, unknown>
}

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateRequest).mockResolvedValue(mockAuthUser)
  prismaMock.monthlyPieceRateOutput.update.mockImplementation((({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...draftOutput(), ...data })) as never)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('PATCH piece-rate-output — VERIFY re-calc theo đơn giá HĐ hiện tại', () => {
  it('đơn giá HĐ đã tăng 100k → 120k: ghi đè totalAmount = 10 × 120k + console.warn', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(
      draftOutput({}, 120_000) as never)

    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID }))
    expect(res.status).toBe(200)

    expect(updateData()).toMatchObject({
      status: 'VERIFIED',
      verifiedBy: 'user-1',
      unitPrice: 120_000,
      totalAmount: 1_200_000,
    })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('lệch đơn giá'))
    expect(recalcBudgetActual).toHaveBeenCalledWith('proj-1', 'user-1')
  })

  it('đơn giá khớp → KHÔNG ghi đè totalAmount/unitPrice, không warn', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(
      draftOutput({}, 100_000) as never)

    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID }))
    expect(res.status).toBe(200)

    const data = updateData()
    expect(data).toMatchObject({ status: 'VERIFIED', verifiedBy: 'user-1' })
    expect(data).not.toHaveProperty('totalAmount')
    expect(data).not.toHaveProperty('unitPrice')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('đã VERIFIED → idempotent, không update lại', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(
      draftOutput({ status: 'VERIFIED', verifiedBy: 'user-0' }) as never)

    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID }))
    expect(res.status).toBe(200)
    expect(prismaMock.monthlyPieceRateOutput.update).not.toHaveBeenCalled()
    expect(recalcBudgetActual).not.toHaveBeenCalled()
  })

  it('404 khi output không tồn tại', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(null)
    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID }))
    expect(res.status).toBe(404)
  })
})

describe('PATCH piece-rate-output — UNVERIFY (VERIFIED → DRAFT)', () => {
  it('R02/R08 (được VERIFY) vẫn bị 403 khi UNVERIFY', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(
      draftOutput({ status: 'VERIFIED', verifiedBy: 'user-0' }) as never)

    for (const roleCode of ['R02', 'R08']) {
      vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode })
      const res = await patchOutput(patchReq({ outputId: OUTPUT_ID, action: 'UNVERIFY' }))
      expect(res.status).toBe(403)
    }
    expect(prismaMock.monthlyPieceRateOutput.update).not.toHaveBeenCalled()
    expect(recalcBudgetActual).not.toHaveBeenCalled()
  })

  it('R01 UNVERIFY → status DRAFT, verifiedBy null + recalcBudgetActual', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(
      draftOutput({ status: 'VERIFIED', verifiedBy: 'user-0' }) as never)

    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID, action: 'UNVERIFY' }))
    expect(res.status).toBe(200)
    expect(prismaMock.monthlyPieceRateOutput.update).toHaveBeenCalledWith({
      where: { id: OUTPUT_ID },
      data: { status: 'DRAFT', verifiedBy: null },
    })
    expect(recalcBudgetActual).toHaveBeenCalledWith('proj-1', 'user-1')
  })

  it('R10 cũng được UNVERIFY', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({ ...mockAuthUser, roleCode: 'R10' })
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(
      draftOutput({ status: 'VERIFIED', verifiedBy: 'user-0' }) as never)

    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID, action: 'UNVERIFY' }))
    expect(res.status).toBe(200)
    expect(updateData()).toMatchObject({ status: 'DRAFT', verifiedBy: null })
  })

  it('output đang DRAFT → idempotent, không update, không recalc', async () => {
    prismaMock.monthlyPieceRateOutput.findUnique.mockResolvedValue(draftOutput() as never)

    const res = await patchOutput(patchReq({ outputId: OUTPUT_ID, action: 'UNVERIFY' }))
    expect(res.status).toBe(200)
    expect(prismaMock.monthlyPieceRateOutput.update).not.toHaveBeenCalled()
    expect(recalcBudgetActual).not.toHaveBeenCalled()
  })
})
