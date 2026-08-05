import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { maybeSyncEstimateToBudget, runHooks } from '@/lib/work-hooks'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/amend  { resultData: {...}, reason?: string }
// BỔ SUNG / CHỈNH SỬA dữ liệu biểu mẫu của task — KỂ CẢ khi đã DONE.
// Dùng khi user lỡ up biểu mẫu nhầm / chưa parse → các bước sau bị khuyết dữ liệu.
//
// Sau khi merge resultData, tự RE-PROPAGATE:
//   • maybeSyncEstimateToBudget: đẩy lại 4 tổng dự toán → Budget.planned (materialized)
//   • runHooks: các hook nghiệp vụ gắn với bước
// Các consumer ĐỌC TRỰC TIẾP (P2.4/P2.5/thiết kế/thương mại qua fetchEstimateData)
// tự cập nhật ở lần mở kế tiếp — không cần đẩy tay tới từng task.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { resultData?: Record<string, unknown>; reason?: string }
    if (!body.resultData || typeof body.resultData !== 'object' || Array.isArray(body.resultData)) {
      return errorResponse('Thiếu resultData hợp lệ', 400)
    }

    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, projectId: true, resultData: true, createdBy: true, hookKeys: true, taskType: true, assignees: { select: { userId: true, role: true } } },
    })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    // Quyền: người tạo / đúng role của bước / BGĐ / Admin
    const allowed = task.createdBy === payload.userId
      || task.assignees.some((a) => a.userId === payload.userId || a.role === payload.roleCode)
      || ['R01', 'R10'].includes(payload.roleCode)
    if (!allowed) return errorResponse('Bạn không có quyền chỉnh sửa công việc này', 403)

    const cur = (task.resultData && typeof task.resultData === 'object' && !Array.isArray(task.resultData))
      ? (task.resultData as Record<string, unknown>) : {}
    const merged = { ...cur, ...body.resultData }

    await prisma.task.update({ where: { id }, data: { resultData: merged as Prisma.InputJsonValue, updatedAt: new Date() } })
    await prisma.taskHistory.create({ data: { taskId: id, action: 'EDITED', byUserId: payload.userId, reason: body.reason || 'Bổ sung/chỉnh sửa biểu mẫu (sau DONE)' } })

    // Re-propagate: sync dự toán → Budget + hooks. Không chặn nếu lỗi phụ.
    await maybeSyncEstimateToBudget(task.projectId, payload.userId, merged).catch((e) => console.error('[amend] estimate sync:', e))
    await runHooks(task.hookKeys, { projectId: task.projectId, userId: payload.userId, resultData: body.resultData }).catch((e) => console.error('[amend] hooks:', e))
    await logAudit(payload.userId, 'AMEND_TASK', 'Task', id, { keys: Object.keys(body.resultData), reason: body.reason }, getClientIP(req)).catch(() => {})

    return successResponse({ ok: true }, 'Đã cập nhật & đồng bộ dữ liệu')
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/amend error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
