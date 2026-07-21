import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { changeRequestSchema } from '@/lib/schemas'
import { createChangeRequest } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/change-request — người tạo gửi yêu cầu (Xóa việc / Sửa người nhận) → tạo việc cho QTHT
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const result = await validateBody(req, changeRequestSchema)
    if (!result.success) return result.response
    const r = await createChangeRequest(id, payload.userId, result.data)
    return successResponse(r, 'Đã gửi yêu cầu cho Quản trị hệ thống')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/change-request error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
