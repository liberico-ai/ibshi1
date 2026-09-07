import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { buildKhoanReport } from '@/lib/khoan-report'

// GET /api/reports/khoan-theo-xuong
//
// Báo cáo khối lượng hoàn thành & giá trị khoán: Xưởng → Dự án → Lệnh → Công đoạn.
// Phép tính nằm ở src/lib/khoan-report.ts, dùng chung với file export để hai nơi không lệch.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { workshops, totals, scope, scopeMissing } = await buildKhoanReport(user.userId, user.roleCode)
  return successResponse({ workshops, totals, scope, scopeMissing })
}
