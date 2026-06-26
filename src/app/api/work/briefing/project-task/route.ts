import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { BRIEFING_WRITE_ROLES } from '@/lib/constants'
import { createTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(BRIEFING_WRITE_ROLES as readonly string[]).includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / NV QLDA / IT được tạo việc')

    const body = await req.json() as {
      projectId?: string
      title?: string
      assigneeUserIds?: string[]
      deadline?: string
      description?: string
    }

    if (!body.title?.trim()) return errorResponse('Cần tiêu đề', 400)
    if (!body.assigneeUserIds?.length) return errorResponse('Cần ít nhất 1 người nhận', 400)

    const newTask = await createTask({
      title: body.title.trim(),
      description: body.description?.trim() || undefined,
      projectId: body.projectId || undefined,
      taskType: 'FREE',
      priority: 'NORMAL',
      deadline: body.deadline ? new Date(body.deadline).toISOString() : undefined,
      assignees: body.assigneeUserIds.map((uid, i) => ({ userId: uid, isPrimary: i === 0 })),
    }, payload.userId)

    return successResponse({ taskId: newTask.id, title: body.title.trim() })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('người') || msg.includes('nhận')) return errorResponse(msg, 400)
    console.error('POST /api/work/briefing/project-task error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
