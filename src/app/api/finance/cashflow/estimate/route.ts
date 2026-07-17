import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { fetchEstimateData } from '@/lib/data-fetchers'

// Roles cho phép xem dự toán tài chính (DTTC): BGĐ, PM, KTKH, Kế toán.
// Giống gate của POST/GET plan — R08 (Kế toán) là mục tiêu chính của Mức 1.
const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a']

// 4 nhóm Budget chuẩn (DTTC) — luôn trả đủ 4 dòng, thiếu → planned/committed/actual = 0.
const BUDGET_CATEGORIES = ['MATERIAL', 'LABOR', 'SERVICE', 'OVERHEAD'] as const

/**
 * GET /api/finance/cashflow/estimate?projectId=...
 *
 * Cầu nối THIẾU trước đây: cho màn Dòng tiền đọc DTTC (dự toán KTKH) ở cấp DỰ ÁN
 * (fetchEstimateData vốn chỉ gọi được trong ngữ cảnh task). READ-ONLY.
 *
 * Trả:
 *   estimate: resultData form ESTIMATE (P1.2, merge P2.1A) hoặc {} nếu chưa có
 *   budget:   mảng 4 nhóm { category, planned, committed, actual, notes } (project-scoped)
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!ALLOWED_ROLES.includes(user.roleCode)) {
      return errorResponse('Forbidden. Role not allowed.', 403)
    }

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    if (!projectId) {
      return errorResponse('projectId is required', 400)
    }

    // DTTC dự toán (P1.2 + P2.1A). fetchEstimateData luôn trả {} (không null) khi merge.
    const estimate = await fetchEstimateData(projectId, { mergeP21A: true })

    // Budget 4 nhóm cấp dự án (month/year = null). Kế toán (R08) đọc được.
    const rows = await prisma.budget.findMany({
      where: { projectId, month: null, year: null },
    })
    const byCategory = new Map(rows.map(r => [r.category, r]))

    const budget = BUDGET_CATEGORIES.map((category) => {
      const r = byCategory.get(category)
      return {
        category,
        planned: r ? Number(r.planned) : 0,
        committed: r ? Number(r.committed) : 0,
        actual: r ? Number(r.actual) : 0,
        notes: r?.notes ?? null,
      }
    })

    return successResponse({ estimate: estimate ?? {}, budget })
  } catch (err) {
    console.error('Cashflow estimate (DTTC) error:', err)
    return errorResponse('Lỗi hệ thống khi tải dự toán tài chính', 500)
  }
}
