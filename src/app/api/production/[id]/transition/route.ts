import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { RBAC } from '@/lib/rbac-rules'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// Valid WO transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['QC_PENDING', 'ON_HOLD'],
  ON_HOLD: ['IN_PROGRESS'],
  QC_PENDING: ['QC_PASSED', 'QC_FAILED'],
  QC_FAILED: ['IN_PROGRESS'], // rework
  QC_PASSED: ['COMPLETED'],
  COMPLETED: [], // terminal
}

// POST /api/production/[id]/transition — Transition WO status
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const body = await req.json()
    const { nextStatus, comment } = body

    if (!nextStatus) return errorResponse('Thiếu trạng thái mới (nextStatus)')

    const wo = await prisma.workOrder.findUnique({ where: { id } })
    if (!wo) return errorResponse('Work Order không tồn tại', 404)

    const currentStatus = wo.status
    const allowed = VALID_TRANSITIONS[currentStatus]

    if (!allowed) return errorResponse(`Trạng thái ${currentStatus} không hợp lệ`)
    if (!allowed.includes(nextStatus)) {
      return errorResponse(`Không thể chuyển từ ${currentStatus} → ${nextStatus}. Cho phép: ${allowed.join(', ')}`)
    }

    // Role check: only R06/R06b can start/progress, R09 for QC
    if (['IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].includes(nextStatus) && !RBAC.PRODUCTION_ACTION.includes(user.roleCode)) {
      return errorResponse('Chỉ bộ phận SX hoặc GĐ được thao tác trạng thái này', 403)
    }
    if (['QC_PASSED', 'QC_FAILED'].includes(nextStatus) && !RBAC.QC_ACTION.includes(user.roleCode)) {
      return errorResponse('Chỉ máy trưởng QC hoặc GĐ được đánh giá kết quả kiểm tra', 403)
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'IN_PROGRESS' && !wo.actualStart ? { actualStart: new Date() } : {}),
        ...(nextStatus === 'COMPLETED' ? { actualEnd: new Date() } : {}),
      },
    })

    await logAudit(user.userId, 'TRANSITION', 'WorkOrder', id,
      { woCode: wo.woCode, from: currentStatus, to: nextStatus, comment }, getClientIP(req))

    return successResponse({ workOrder: updated },
      `WO ${wo.woCode}: ${currentStatus} → ${nextStatus}`)
  } catch (err) {
    console.error('POST /api/production/[id]/transition error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
