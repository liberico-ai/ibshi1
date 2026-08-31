import { isMissingTableError, MIGRATION_HINT } from '@/lib/db-missing-table'
import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { MR_STATUS } from '@/lib/wo-materials'
import { isProjectPm as isPm } from '@/lib/project-pm'
import { notifyMaterialRequestPmApproved, notifyMaterialRequestClosed } from '@/lib/material-request-flow'

// Duyệt / trả lại một phiếu đề nghị cấp vật tư.
//   POST { action: 'approve' | 'reject', reason? }
// Tuần tự: PENDING_PM → (PM phụ trách dự án duyệt) → PENDING_BOD → (BGĐ duyệt) → APPROVED.
// Kho chỉ thấy phiếu APPROVED. Trả lại ở bất kỳ chặng nào → REJECTED, xưởng sửa rồi gửi lại.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const body = await req.json().catch(() => ({}))
    const action = body?.action === 'reject' ? 'reject' : 'approve'
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

    const order = await prisma.materialRequestOrder.findUnique({
      where: { id },
      select: {
        id: true, code: true, status: true, projectId: true,
        project: { select: { projectCode: true, pmUserId: true } },
      },
    })
    if (!order) return errorResponse('Không tìm thấy phiếu', 404)

    const isPmStage = order.status === MR_STATUS.PENDING_PM
    const isBodStage = order.status === MR_STATUS.PENDING_BOD
    if (!isPmStage && !isBodStage) {
      return errorResponse(`Phiếu ${order.code} không ở trạng thái chờ duyệt (đang: ${order.status})`)
    }

    // Chặng PM: chỉ PM PHỤ TRÁCH DỰ ÁN. Chặng BGĐ: R01 (Admin R10 hỗ trợ kỹ thuật).
    if (isPmStage) {
      const isProjectPm = await isPm(user.userId, order.projectId)
      if (!isProjectPm && user.roleCode !== 'R10') {
        return errorResponse(`Chỉ PM phụ trách dự án ${order.project.projectCode} được duyệt phiếu này`, 403)
      }
    } else if (!['R01', 'R10'].includes(user.roleCode)) {
      return errorResponse('Chỉ Ban Giám đốc được duyệt ở bước này', 403)
    }

    if (action === 'reject') {
      if (!reason) return errorResponse('Nhập lý do trả lại để xưởng biết cần sửa gì')
      const updated = await prisma.materialRequestOrder.update({
        where: { id },
        data: { status: MR_STATUS.REJECTED, rejectedBy: user.userId, rejectedAt: new Date(), rejectReason: reason },
      })
      await notifyMaterialRequestClosed(id, user.userId, { approved: false, reason }).catch(e => console.error('[MR] notify:', e))
      await logAudit(user.userId, 'REJECT_MATERIAL_REQUEST', 'MaterialRequestOrder', id,
        { code: order.code, stage: isPmStage ? 'PM' : 'BOD', reason }, getClientIP(req))
      return successResponse({ order: updated }, `Đã trả lại phiếu ${order.code} cho xưởng`)
    }

    if (isPmStage) {
      const updated = await prisma.materialRequestOrder.update({
        where: { id },
        data: { status: MR_STATUS.PENDING_BOD, pmApprovedBy: user.userId, pmApprovedAt: new Date() },
      })
      await notifyMaterialRequestPmApproved(id, user.userId).catch(e => console.error('[MR] notify:', e))
      await logAudit(user.userId, 'APPROVE_MATERIAL_REQUEST', 'MaterialRequestOrder', id,
        { code: order.code, stage: 'PM' }, getClientIP(req))
      return successResponse({ order: updated }, `PM đã duyệt phiếu ${order.code} — chuyển BGĐ duyệt`)
    }

    const updated = await prisma.materialRequestOrder.update({
      where: { id },
      data: { status: MR_STATUS.APPROVED, bodApprovedBy: user.userId, bodApprovedAt: new Date() },
    })
    await notifyMaterialRequestClosed(id, user.userId, { approved: true }).catch(e => console.error('[MR] notify:', e))
    await logAudit(user.userId, 'APPROVE_MATERIAL_REQUEST', 'MaterialRequestOrder', id,
      { code: order.code, stage: 'BOD' }, getClientIP(req))
    return successResponse({ order: updated }, `BGĐ đã duyệt phiếu ${order.code} — Kho có thể cấp vật tư`)
  } catch (err) {
    console.error('POST /api/production/material-requests/[id] error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
