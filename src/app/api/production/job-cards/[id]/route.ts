import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { updateJobCardSchema, idParamSchema } from '@/lib/schemas'
import { rollUpWorkOrder } from '@/lib/production-weights'
import { can } from '@/lib/permissions/can'

// GET /api/production/job-cards/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response

  const jc = await prisma.jobCard.findUnique({
    where: { id: pResult.data.id },
    include: { workOrder: { select: { woCode: true, description: true, pieceMark: true, plannedWeight: true } } },
  })
  if (!jc) return errorResponse('Không tìm thấy phiếu công việc', 404)

  return successResponse({
    jobCard: { ...jc, plannedQty: Number(jc.plannedQty), actualQty: Number(jc.actualQty) },
  })
}

// PUT /api/production/job-cards/[id] — Update actualQty, manpower, status, approve
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const bodyResult = await validateBody(req, updateJobCardSchema)
    if (!bodyResult.success) return bodyResult.response
    const updates = bodyResult.data

    const jc = await prisma.jobCard.findUnique({
      where: { id },
      include: { workOrder: { select: { id: true, status: true } } },
    })
    if (!jc) return errorResponse('Không tìm thấy phiếu công việc', 404)
    if (jc.status === 'CANCELLED') return errorResponse('Phiếu đã bị hủy')

    if (updates.status === 'COMPLETED' && !(await can(user, 'action.production'))) {
      return errorResponse('Chỉ bộ phận SX được hoàn thành phiếu', 403)
    }

    const data: Record<string, unknown> = {}
    if (updates.actualQty !== undefined) data.actualQty = updates.actualQty
    if (updates.manpower !== undefined) data.manpower = updates.manpower
    if (updates.startTime !== undefined) data.startTime = new Date(updates.startTime)
    if (updates.endTime !== undefined) data.endTime = new Date(updates.endTime)
    if (updates.notes !== undefined) data.notes = updates.notes
    if (updates.status !== undefined) data.status = updates.status

    if (updates.status === 'COMPLETED' && !jc.approvedBy) {
      data.approvedBy = user.userId
    }

    const updated = await prisma.jobCard.update({
      where: { id },
      data,
      include: { workOrder: { select: { woCode: true } } },
    })

    if (updates.status === 'COMPLETED') {
      await rollUpWorkOrder(jc.workOrder.id)
    }

    await logAudit(user.userId, 'UPDATE', 'JobCard', id, { ...updates }, getClientIP(req))

    return successResponse({
      jobCard: { ...updated, plannedQty: Number(updated.plannedQty), actualQty: Number(updated.actualQty) },
      message: updates.status === 'COMPLETED' ? `Hoàn thành ${updated.jobCode}, đã cập nhật tiến độ WO` : `Đã cập nhật ${updated.jobCode}`,
    })
  } catch (err) {
    console.error('PUT /api/production/job-cards/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
