import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { BRIEFING_WRITE_ROLES } from '@/lib/constants'
import { createTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(BRIEFING_WRITE_ROLES as readonly string[]).includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / NV QLDA / IT được tạo việc từ đề xuất')

    const body = await req.json() as {
      sourceTaskId?: string
      title?: string
      assigneeUserIds?: string[]
      deadline?: string
      note?: string
    }

    if (!body.sourceTaskId) return errorResponse('Cần sourceTaskId', 400)
    if (!body.title?.trim()) return errorResponse('Cần tiêu đề', 400)
    if (!body.assigneeUserIds?.length) return errorResponse('Cần ít nhất 1 người nhận', 400)

    const source = await prisma.task.findUnique({
      where: { id: body.sourceTaskId },
      select: { id: true, projectId: true, resultData: true },
    })
    if (!source) return errorResponse('Task nguồn không tìm thấy', 404)

    const rd = (source.resultData && typeof source.resultData === 'object') ? source.resultData as Record<string, unknown> : {}
    const briefing = (rd.briefing && typeof rd.briefing === 'object') ? rd.briefing as Record<string, unknown> : {}
    const existing = Array.isArray(briefing.actionItems) ? briefing.actionItems as { taskId: string }[] : []

    const newTask = await createTask({
      title: body.title.trim(),
      description: body.note?.trim() || undefined,
      projectId: source.projectId || undefined,
      taskType: 'FREE',
      priority: 'NORMAL',
      deadline: body.deadline ? new Date(body.deadline).toISOString() : undefined,
      assignees: body.assigneeUserIds.map((uid, i) => ({ userId: uid, isPrimary: i === 0 })),
    }, payload.userId, { forwardedFromId: body.sourceTaskId })

    await prisma.task.update({
      where: { id: newTask.id },
      data: {
        resultData: {
          ...(typeof newTask.resultData === 'object' && newTask.resultData ? newTask.resultData as Record<string, unknown> : {}),
          sourceTaskId: body.sourceTaskId,
        },
      },
    })

    const updatedItems = [...existing, { taskId: newTask.id, title: body.title.trim() }]
    await prisma.task.update({
      where: { id: body.sourceTaskId },
      data: {
        resultData: { ...rd, briefing: { ...briefing, actionItems: updatedItems } },
      },
    })

    return successResponse({ taskId: newTask.id, title: body.title.trim(), actionItems: updatedItems })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('không tìm') || msg.includes('vô hiệu') || msg.includes('Không tìm')) return errorResponse(msg, 400)
    console.error('POST /api/work/briefing/action-item error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
