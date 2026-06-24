import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { reassignTask } from '@/lib/work-engine'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R10']

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ALLOWED_ROLES.includes(payload.roleCode)) return forbiddenResponse('Chỉ PM / BGĐ được đổi người')

    const { taskId, assigneeUserIds } = await req.json() as { taskId?: string; assigneeUserIds?: string[] }
    if (!taskId) return errorResponse('Cần taskId', 400)
    if (!assigneeUserIds?.length) return errorResponse('Cần ít nhất 1 người nhận', 400)

    const assignees = assigneeUserIds.map((uid, i) => ({ userId: uid, isPrimary: i === 0 }))
    await reassignTask(taskId, payload.userId, { assignees })

    const prisma = (await import('@/lib/db')).default
    const fresh = await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })
    const userIds = fresh.map(a => a.userId).filter((x): x is string => !!x)
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : []
    const nameMap = new Map(users.map(u => [u.id, u.fullName]))
    const result = userIds.map(uid => ({ userId: uid, name: nameMap.get(uid) || '—' }))

    return successResponse({ assignees: result })
  } catch (err) {
    const msg = (err as Error).message
    if (msg.includes('không tìm') || msg.includes('vô hiệu') || msg.includes('Không tìm')) return errorResponse(msg, 400)
    console.error('POST /api/work/briefing/reassign error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
