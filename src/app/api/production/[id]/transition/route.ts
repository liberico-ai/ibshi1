import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { rollUpWorkOrder } from '@/lib/production-weights'
import { isWorkOrderQcPassed } from '@/lib/qc-gate'
import { woMaterialGate } from '@/lib/process-gates'
import { buildWoMaterialLines } from '@/lib/wo-materials'
import { getWoAcceptanceOne } from '@/lib/wo-acceptance'

// Valid WO transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  // WO sinh ra mặc định chờ vật tư. Kho cấp đủ → OPEN (đường cũ, vẫn giữ).
  // IN_PROGRESS: xưởng bắt đầu luôn mà chưa cần đủ vật tư — chỉ mở khi cổng vật tư TẮT,
  // xem isWoMaterialGateEnabled() ở dưới. Trạng thái vẫn là "Chờ vật tư" cho tới khi
  // xưởng bấm bắt đầu, nên nhìn danh sách vẫn biết lệnh nào chưa được cấp.
  // QC_PENDING mở từ mọi trạng thái đang chạy: nghiệm thu theo ĐỢT nên xưởng báo được khối lượng
  // lúc nào là mời nghiệm thu được lúc đó, không phải chờ lệnh chạy đúng một trạng thái nhất định.
  PENDING_MATERIAL: ['OPEN', 'IN_PROGRESS', 'QC_PENDING'],
  OPEN: ['IN_PROGRESS', 'QC_PENDING'],
  IN_PROGRESS: ['QC_PENDING', 'ON_HOLD'],
  ON_HOLD: ['IN_PROGRESS'],
  QC_PENDING: ['QC_PASSED', 'QC_FAILED'],
  QC_FAILED: ['IN_PROGRESS'], // rework
  QC_PASSED: ['COMPLETED', 'QC_PENDING'], // QC_PENDING = đưa về QC lại (needsReQc do ECO)
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
    if (['IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].includes(nextStatus) && !(await can(user, 'action.production'))) {
      return errorResponse('Chỉ bộ phận SX hoặc GĐ được thao tác trạng thái này', 403)
    }
    // Mở WO (đủ vật tư): SX hoặc Kho
    if (nextStatus === 'OPEN' && !((await can(user, 'action.production')) || ['R05', 'R05a', 'R08', 'R08a'].includes(user.roleCode))) {
      return errorResponse('Chỉ SX/Kho hoặc GĐ được mở WO', 403)
    }

    // Cổng vật tư: khi BẬT thì giữ đúng luật cũ — chưa cấp đủ thì không được bắt đầu.
    // Khi TẮT (mặc định hiện nay) thì xưởng bắt đầu thẳng từ "Chờ vật tư".
    if (currentStatus === 'PENDING_MATERIAL' && nextStatus === 'IN_PROGRESS' && await woMaterialGate.enabled()) {
      const lines = await buildWoMaterialLines(id)
      const thieu = lines.filter(l => l.issued < l.requested).length
      return errorResponse(
        thieu > 0
          ? `Chưa cấp đủ vật tư (còn ${thieu}/${lines.length} dòng thiếu) — Kho cấp đủ thì lệnh tự mở`
          : 'Lệnh đang chờ vật tư — Kho cấp đủ thì lệnh tự mở',
        422,
      )
    }
    if (['QC_PASSED', 'QC_FAILED'].includes(nextStatus) && !(await can(user, 'action.qc'))) {
      return errorResponse('Chỉ máy trưởng QC hoặc GĐ được đánh giá kết quả kiểm tra', 403)
    }

    if (nextStatus === 'QC_PASSED') {
      // Transition này CHÍNH LÀ re-QC: bỏ qua riêng flag needsReQc (tránh deadlock),
      // vẫn kiểm đủ NDT/NCR/biên bản; thành công thì auto-clear flag ở dưới.
      const qcResult = await isWorkOrderQcPassed(id, { ignoreReQcFlag: true })
      if (!qcResult.passed) {
        return errorResponse('QC chưa đạt: ' + qcResult.reasons.join('; '), 422)
      }
    }
    // WO bị flag re-QC (do ECO) không được đóng hoàn thành — phải QC lại trước
    if (nextStatus === 'COMPLETED' && wo.needsReQc) {
      return errorResponse(`WO cần QC lại trước khi hoàn thành: ${wo.reQcReason || 'needsReQc'}`, 422)
    }
    // Mời nghiệm thu: phải có khối lượng đã báo mà chưa nghiệm thu, không thì mời suông.
    if (nextStatus === 'QC_PENDING') {
      const acc = await getWoAcceptanceOne(id)
      if (acc && acc.availableKg <= 0) {
        return errorResponse(
          acc.pendingKg > 0
            ? `Đã mời nghiệm thu ${acc.pendingKg.toLocaleString('vi-VN')} kg, đang chờ chữ ký — báo thêm khối lượng thì mới mời đợt mới`
            : 'Chưa có khối lượng nào chờ nghiệm thu — xưởng báo khối lượng trước',
          422)
      }
      // Đưa WO đã QC Đạt về nghiệm thu lại: xưởng làm được khi có khối lượng MỚI (đợt tiếp theo);
      // còn yêu cầu kiểm lại phần đã ký (ECO, phát hiện lỗi) thì vẫn chỉ QC/GĐ.
      const newVolume = !!acc && acc.availableKg > 0
      const mayInvite = (await can(user, 'action.qc')) || (await can(user, 'action.production')) || newVolume
      if (currentStatus === 'QC_PASSED' && !mayInvite) {
        return errorResponse('Chỉ QC hoặc GĐ được yêu cầu kiểm tra lại', 403)
      }
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: nextStatus,
        ...(nextStatus === 'IN_PROGRESS' && !wo.actualStart ? { actualStart: new Date() } : {}),
        ...(nextStatus === 'COMPLETED' ? { actualEnd: new Date() } : {}),
        ...(nextStatus === 'QC_PASSED' ? { needsReQc: false, reQcReason: null } : {}),
      },
    })

    if (['QC_PASSED', 'COMPLETED'].includes(nextStatus)) {
      await rollUpWorkOrder(id)
    }

    await logAudit(user.userId, 'TRANSITION', 'WorkOrder', id,
      { woCode: wo.woCode, from: currentStatus, to: nextStatus, comment }, getClientIP(req))

    return successResponse({ workOrder: updated },
      `WO ${wo.woCode}: ${currentStatus} → ${nextStatus}`)
  } catch (err) {
    console.error('POST /api/production/[id]/transition error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
