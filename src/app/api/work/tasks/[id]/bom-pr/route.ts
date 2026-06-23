import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { canEditForm } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// POST /api/work/tasks/[id]/bom-pr  { data: string }  — lưu dữ liệu PR (BomPrUploadUI) vào task
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params

    if (!canEditForm('PR', payload.roleCode)) {
      return errorResponse('Bạn không có quyền sửa biểu mẫu PR', 403)
    }

    const body = await req.json().catch(() => ({})) as { data?: string }
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, createdBy: true, assignees: { select: { userId: true, role: true } } },
    })
    if (!task) return errorResponse('Không tìm thấy công việc', 404)

    const isParticipant = task.createdBy === payload.userId
      || task.assignees.some(a => a.userId === payload.userId || a.role === payload.roleCode)
    if (!isParticipant) return errorResponse('Bạn không có quyền sửa công việc này', 403)

    const patch = JSON.stringify({ bomPr: body.data || '' })
    await prisma.$executeRaw`
      UPDATE "tasks"
      SET "result_data" = COALESCE("result_data", '{}'::jsonb) || ${patch}::jsonb,
          "updated_at" = now()
      WHERE "id" = ${id}`
    return successResponse({})
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/bom-pr error:', err)
    return errorResponse('Lỗi lưu PR', 500)
  }
}
