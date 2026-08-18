import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'

// PATCH /api/projects/:id/pm  body: { pmUserId }
// Gán / ĐỔI PM phụ trách dự án. Đồng thời chuyển các task đang mở của dự án (role R02) về đúng PM đó
// → hết cảnh "R02 chung chung / chưa phân công". Quyền: BGĐ (R01) · IT (R10) · hoặc chính PM hiện tại (bàn giao).
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, projectCode: true, pmUserId: true } })
  if (!project) return errorResponse('Không tìm thấy dự án', 404)

  // Quyền: BGĐ / IT toàn quyền; PM hiện tại được bàn giao cho người khác.
  const isAdmin = ['R01', 'R10'].includes(payload.roleCode)
  const isCurrentPm = !!project.pmUserId && project.pmUserId === payload.userId
  if (!isAdmin && !isCurrentPm) return errorResponse('Chỉ BGĐ / IT hoặc PM hiện tại mới được đổi PM phụ trách', 403)

  const body = await req.json().catch(() => ({})) as { pmUserId?: string }
  const pmUserId = String(body.pmUserId || '').trim()
  if (!pmUserId) return errorResponse('Thiếu PM phụ trách (pmUserId)', 400)

  const pm = await prisma.user.findUnique({ where: { id: pmUserId }, select: { id: true, fullName: true, roleCode: true, isActive: true } })
  if (!pm) return errorResponse('Không tìm thấy nhân sự PM', 404)
  if (!pm.isActive) return errorResponse('Tài khoản PM đã vô hiệu', 400)
  if (pm.roleCode !== 'R02') return errorResponse('PM phụ trách phải là Quản lý dự án (R02)', 400)

  const oldPm = project.pmUserId

  // Chuyển task đang mở của dự án (role R02) về PM mới
  const openTasks = await prisma.task.findMany({
    where: { projectId: id, status: { notIn: ['DONE', 'CANCELLED', 'CLOSED'] } },
    select: { id: true },
  })
  const taskIds = openTasks.map(t => t.id)

  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id }, data: { pmUserId } })
    if (taskIds.length) {
      await tx.taskAssignee.updateMany({ where: { taskId: { in: taskIds }, role: 'R02' }, data: { userId: pmUserId } })
    }
  })

  const reassigned = taskIds.length ? await prisma.taskAssignee.count({ where: { taskId: { in: taskIds }, role: 'R02', userId: pmUserId } }) : 0
  await logAudit(payload.userId, 'ASSIGN_PM', 'Project', id, { from: oldPm, to: pmUserId }, getClientIP(req))

  return successResponse(
    { pmUserId, pmName: pm.fullName, reassignedTasks: reassigned },
    `Đã gán PM phụ trách: ${pm.fullName}${reassigned ? ` · chuyển ${reassigned} việc đang mở về PM này` : ''}`,
  )
})
