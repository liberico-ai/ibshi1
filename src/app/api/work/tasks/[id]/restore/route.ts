import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { restoreTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/restore — khôi phục việc đã xóa mềm (CANCELLED). Chỉ R10.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const r = await restoreTask(id, payload.userId, payload.roleCode)
    return successResponse(r, 'Đã khôi phục công việc')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/restore error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
