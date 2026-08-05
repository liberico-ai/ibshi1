import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/dismiss — đánh dấu task "THÔNG BÁO" đã đọc → ẩn khỏi Hộp việc.
// Không phải DONE (không có thao tác nghiệm thu ở đây — trạng thái thật ghi ở tab sidebar);
// coi như "tiêu thụ" thông báo → set status=CANCELLED (inbox tự loại qua filter status sẵn có).
// Idempotent: đã CANCELLED thì bỏ qua.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params

    const task = await prisma.task.findUnique({ where: { id }, select: { status: true, resultData: true } })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    if (task.status !== 'CANCELLED') {
      const rd = (task.resultData && typeof task.resultData === 'object' && !Array.isArray(task.resultData))
        ? (task.resultData as Record<string, unknown>)
        : {}
      await prisma.task.update({
        where: { id },
        data: { status: 'CANCELLED', resultData: { ...rd, dismissed: true, dismissedBy: payload.userId, dismissedAt: new Date().toISOString() } },
      })
      await prisma.taskHistory.create({ data: { taskId: id, action: 'CANCELLED', byUserId: payload.userId, reason: 'Đã đọc thông báo' } }).catch(() => {})
    }
    return successResponse({ dismissed: true })
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/dismiss error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
