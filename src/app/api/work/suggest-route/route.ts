import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { suggestRoute } from '@/lib/work-engine'
import { DEPT_NAME } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

// GET /api/work/suggest-route?context=<taskType|stepCode> — gợi ý phòng nhận tiếp (seed từ 36 bước)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const sp = new URL(req.url).searchParams
    const context = sp.get('context')?.trim() || ''
    const text = sp.get('text')?.trim() || ''
    if (!context && !text) return successResponse({ suggestions: [] })
    const rows = await suggestRoute(context, text)
    return successResponse({
      suggestions: rows.map((s) => ({
        roleCode: s.toRoleCode,
        departmentCode: s.toDepartmentCode,
        departmentName: s.toDepartmentCode ? DEPT_NAME[s.toDepartmentCode] || s.toDepartmentCode : null,
        reason: s.reason,
      })),
    })
  } catch (err) {
    console.error('GET /api/work/suggest-route error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
