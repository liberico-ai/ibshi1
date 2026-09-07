import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { withErrorHandler } from '@/lib/with-error-handler'
import { getWoAcceptanceOne } from '@/lib/wo-acceptance'
import { RBAC } from '@/lib/rbac-rules'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/production/:id/stages/:stageId/invite-qc — Mời nghiệm thu MỘT công đoạn.
//
// Trước đây chỉ mời được ở cấp lệnh: lệnh vào "Chờ QC" một lần rồi mọi công đoạn báo sau đều
// bị coi là đã mời — xưởng báo bảo ôn xong quay ra thấy tự nhiên "đã mời QC" mà chưa ai bấm.
// Lời mời giờ ghi ngay trên công đoạn: mời cái nào chỉ tính cái đó.
// ─────────────────────────────────────────────────────────────────────────────
export const POST = withErrorHandler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stageId: string }> },
) => {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id, stageId } = await params

  // Cùng quyền với nút mời cũ ở cấp lệnh: sản xuất bấm mời, QC/GĐ cũng bấm được.
  if (!RBAC.PRODUCTION_ACTION.includes(user.roleCode) && !RBAC.QC_ACTION.includes(user.roleCode)) {
    return errorResponse('Không có quyền mời nghiệm thu', 403)
  }

  const wo = await prisma.workOrder.findUnique({
    where: { id }, select: { id: true, woCode: true, status: true },
  })
  if (!wo) return errorResponse('Không tìm thấy lệnh sản xuất', 404)
  if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
    return errorResponse('Lệnh đã đóng sổ — không mời nghiệm thu được nữa', 422)
  }

  const stage = await prisma.workOrderStage.findUnique({
    where: { id: stageId }, select: { id: true, workOrderId: true, stageCode: true, name: true },
  })
  if (!stage || stage.workOrderId !== id) {
    return errorResponse('Công đoạn không thuộc lệnh này', 422)
  }

  const acc = await getWoAcceptanceOne(id)
  const st = acc?.stages.find(s => s.id === stageId)
  if (!st) return errorResponse('Không đọc được tình hình nghiệm thu của công đoạn', 500)

  // Chỉ mời phần THẬT SỰ còn chờ: đã ký rồi, hoặc đã bấm mời rồi, thì không mời lại.
  if (st.needInviteQty <= 0) {
    if (st.invitedQty > 0) {
      return errorResponse(
        `Đã mời nghiệm thu ${st.invitedQty.toLocaleString('vi-VN')} ${st.unit} cho ${st.stageCode} ${st.name}`
        + ' — đang chờ QAQC lập đợt kiểm tra', 422)
    }
    if (st.pendingQty > 0) {
      return errorResponse(
        `${st.stageCode} ${st.name} đang chờ ký ${st.pendingQty.toLocaleString('vi-VN')} ${st.unit}`
        + ' — ký xong đợt cũ rồi báo tiếp mới mời được', 422)
    }
    if (st.reportedQty <= 0) {
      return errorResponse(`${st.stageCode} ${st.name} chưa có phiếu báo khối lượng nào`, 422)
    }
    return errorResponse(
      `${st.stageCode} ${st.name} đã nghiệm thu hết phần đã báo — báo tiếp thì mới mời được`, 422)
  }

  // Cộng dồn vào lời mời đang có: xưởng mời 10.000, báo thêm 5.000 rồi mời tiếp thì lời mời
  // thành 15.000 — QAQC lập một đợt là ăn trọn.
  const moiMoi = Math.round((st.invitedQty + st.needInviteQty) * 100) / 100
  await prisma.workOrderStage.update({
    where: { id: stageId },
    data: { qcInvitedQty: moiMoi, qcInvitedAt: new Date(), qcInvitedBy: user.userId },
  })

  // Lệnh chuyển sang "Chờ QC" để QAQC nhìn thấy trong hàng đợi. Không đụng vào lệnh đã đóng.
  if (wo.status !== 'QC_PENDING') {
    await prisma.workOrder.update({ where: { id }, data: { status: 'QC_PENDING' } })
  }

  await logAudit(user.userId, 'INVITE_QC_STAGE', 'WorkOrderStage', stageId, {
    woCode: wo.woCode, stage: `${st.stageCode} ${st.name}`, qty: moiMoi, unit: st.unit,
  })

  return successResponse({
    message: `Đã mời nghiệm thu ${st.stageCode} ${st.name} — ${moiMoi.toLocaleString('vi-VN')} ${st.unit}`,
    invitedQty: moiMoi,
  })
})
