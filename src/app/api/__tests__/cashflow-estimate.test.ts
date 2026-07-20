/**
 * Route tests for Cashflow Mức 1 — DTTC (dự toán KTKH) endpoint + GET plan gate.
 * GET /api/finance/cashflow/estimate: R08 → 200 (estimate + budget), R05 → 403, thiếu projectId → 400.
 * GET /api/finance/cashflow/plan: R05 → 403 (sau khi vá gate).
 * Prisma deep-mocked; auth mocked.
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
  }
})

import { GET } from '@/app/api/finance/cashflow/estimate/route'
import { GET as PLAN_GET } from '@/app/api/finance/cashflow/plan/route'

const R08 = { userId: 'u8', username: 'kt', roleCode: 'R08', userLevel: 2, fullName: 'Kế toán' }
const R05 = { userId: 'u5', username: 'kho', roleCode: 'R05', userLevel: 2, fullName: 'Kho' }
const PROJECT_ID = 'proj_1'

function getReq(url: string) {
  return new NextRequest(url, { method: 'GET' })
}

beforeEach(() => {
  mockAuth.mockResolvedValue(R08)
  // fetchEstimateData(mergeP21A) → prisma.task.findFirst (P1.2 + P2.1A)
  prismaMock.task.findFirst.mockResolvedValue({
    resultData: { totalMaterial: 100, totalLabor: 50, totalService: 10, totalOverhead: 5, totalEstimate: 165 },
    status: 'COMPLETED',
  } as never)
  // Budget project-scoped 4 nhóm — chỉ có MATERIAL trong DB
  prismaMock.budget.findMany.mockResolvedValue([
    { category: 'MATERIAL', planned: 100, committed: 80, actual: 20, notes: 'từ BOM', month: null, year: null },
  ] as never)
})

describe('GET /api/finance/cashflow/estimate', () => {
  const url = `http://localhost/api/finance/cashflow/estimate?projectId=${PROJECT_ID}`

  it('R08 (Kế toán) → 200 trả estimate + budget 4 nhóm', async () => {
    const res = await GET(getReq(url))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    // estimate = resultData form ESTIMATE
    expect(body.estimate.totalEstimate).toBe(165)
    // budget luôn đủ 4 nhóm (thiếu → 0)
    expect(body.budget).toHaveLength(4)
    const material = body.budget.find((b: any) => b.category === 'MATERIAL')
    expect(material.planned).toBe(100)
    expect(material.committed).toBe(80)
    expect(material.actual).toBe(20)
    expect(material.notes).toBe('từ BOM')
    const labor = body.budget.find((b: any) => b.category === 'LABOR')
    expect(labor.planned).toBe(0) // không có trong DB → 0
    expect(labor.notes).toBeNull()
    // Query đúng phạm vi dự án (month/year = null)
    expect(prismaMock.budget.findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, month: null, year: null },
    })
  })

  it('R05 (Kho) → 403', async () => {
    mockAuth.mockResolvedValue(R05)
    const res = await GET(getReq(url))
    expect(res.status).toBe(403)
    expect(prismaMock.budget.findMany).not.toHaveBeenCalled()
  })

  it('thiếu projectId → 400', async () => {
    const res = await GET(getReq('http://localhost/api/finance/cashflow/estimate'))
    expect(res.status).toBe(400)
  })

  it('401 khi chưa đăng nhập', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(getReq(url))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/finance/cashflow/plan (gate đã vá)', () => {
  it('R05 (Kho) → 403', async () => {
    mockAuth.mockResolvedValue(R05)
    const res = await PLAN_GET(getReq(`http://localhost/api/finance/cashflow/plan?projectId=${PROJECT_ID}`))
    expect(res.status).toBe(403)
  })

  it('R08 (Kế toán) → 200', async () => {
    mockAuth.mockResolvedValue(R08)
    prismaMock.projectFinancePlan.findUnique.mockResolvedValue(null as never)
    const res = await PLAN_GET(getReq(`http://localhost/api/finance/cashflow/plan?projectId=${PROJECT_ID}`))
    expect(res.status).toBe(200)
  })
})
