import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { finalizeTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/finalize — Người giao "Hoàn thành & kết thúc" sau khi người nhận trả về.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    await finalizeTask(id, payload.userId)
    await logAudit(payload.userId, 'FINALIZE', 'Task', id, {}, getClientIP(req))
    return successResponse({}, 'Đã kết thúc công việc')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/finalize error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
