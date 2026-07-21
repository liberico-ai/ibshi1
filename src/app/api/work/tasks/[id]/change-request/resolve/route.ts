import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { resolveChangeRequestSchema } from '@/lib/schemas'
import { resolveChangeRequest } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/change-request/resolve — QTHT (R10) xử lý yêu cầu trên việc gốc [id].
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (payload.roleCode !== 'R10') return forbiddenResponse('Chỉ Quản trị hệ thống được xử lý yêu cầu')
    const { id } = await params
    const result = await validateBody(req, resolveChangeRequestSchema)
    if (!result.success) return result.response
    const r = await resolveChangeRequest(id, payload.userId, payload.roleCode, result.data)
    return successResponse(r, result.data.action === 'REJECT' ? 'Đã từ chối yêu cầu' : 'Đã thực hiện yêu cầu')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/change-request/resolve error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 500)
  }
}
