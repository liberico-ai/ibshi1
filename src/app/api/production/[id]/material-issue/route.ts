import { isMissingTableError, MIGRATION_HINT } from '@/lib/db-missing-table'
import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { applyStockMovement } from '@/lib/stock-ledger'
import { buildWoMaterialLines } from '@/lib/wo-materials'
import { ensureWeeklyReportTask } from '@/lib/workflow-engine'

// Kho cấp vật tư CHO MỘT LỆNH SẢN XUẤT — nhiều dòng một lần, cấp từng phần được.
//
// Khác endpoint issue-material cũ (1 dòng/lần, đòi WO đã OPEN, không ghi MaterialIssue):
//   • Nhận WO đang "Chờ vật tư" (PENDING_MATERIAL) — vì chính việc cấp đủ mới mở WO ra.
//   • Ghi MaterialIssue theo từng dòng → đối chiếu được với đề nghị cấp.
//   • Trừ kho với referenceNo = MÃ WO (truy vết ngược theo lệnh, không phải theo mã dự án).
//   • Cấp đủ toàn bộ danh mục → WO tự chuyển PENDING_MATERIAL → OPEN.
const ISSUABLE = ['PENDING_MATERIAL', 'OPEN', 'IN_PROGRESS']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(await can(user, 'action.store')) && !(await can(user, 'action.production'))) {
      // Nói rõ thiếu quyền gì để admin bật đúng ô, thay vì chỉ "không có quyền".
      return errorResponse(
        `Vai trò ${user.roleCode} chưa có quyền "Thao tác kho (nhập/xuất)". Vào Hệ thống → Ma trận phân quyền bật quyền này cho vai trò đó.`,
        403,
      )
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: { id: true, woCode: true, status: true, projectId: true },
    })
    if (!wo) return errorResponse('Không tìm thấy lệnh sản xuất', 404)
    if (!ISSUABLE.includes(wo.status)) {
      return errorResponse(`WO đang ở trạng thái ${wo.status} — không cấp vật tư được`)
    }

    const body = await req.json().catch(() => ({}))
    const rawLines = Array.isArray(body?.lines) ? body.lines : []
    const heatNumber = body?.heatNumber ? String(body.heatNumber).trim() : null
    const notes = body?.notes ? String(body.notes).trim() : null

    const wanted = rawLines
      .map((l: Record<string, unknown>) => ({ materialId: String(l?.materialId || '').trim(), quantity: Number(l?.quantity) }))
      .filter((l: { materialId: string; quantity: number }) => l.materialId && Number.isFinite(l.quantity) && l.quantity > 0)
    if (wanted.length === 0) return errorResponse('Chưa nhập khối lượng thực xuất nào')

    // Đối chiếu với đề nghị: không cho xuất quá phần còn thiếu, không cho xuất quá tồn kho.
    const lines = await buildWoMaterialLines(id)
    const byId = new Map(lines.map((l) => [l.materialId, l]))
    for (const w of wanted) {
      const line = byId.get(w.materialId)
      if (!line) return errorResponse('Có vật tư không nằm trong danh mục đề nghị của lệnh này')
      if (w.quantity > line.remaining) {
        return errorResponse(`${line.materialCode}: còn thiếu ${line.remaining} ${line.unit}, không xuất được ${w.quantity}`)
      }
      if (w.quantity > line.currentStock) {
        return errorResponse(`${line.materialCode}: tồn kho chỉ còn ${line.currentStock} ${line.unit}`)
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const w of wanted) {
        const line = byId.get(w.materialId)!
        await tx.materialIssue.create({
          data: {
            workOrderId: id, materialId: w.materialId, quantity: w.quantity,
            issuedBy: user.userId, heatNumber, notes,
          },
        })
        await applyStockMovement(tx, {
          materialId: w.materialId,
          projectId: wo.projectId,
          type: 'OUT',
          quantity: w.quantity,
          reason: 'wo_issue',
          referenceNo: wo.woCode,
          heatNumber,
          performedBy: user.userId,
          notes: notes || `Cấp cho ${wo.woCode}: ${line.materialCode} x ${w.quantity} ${line.unit}`,
        })
      }
    })

    // Đủ toàn bộ danh mục → mở WO để xưởng nhận lệnh.
    const after = await buildWoMaterialLines(id)
    const fulfilled = after.length > 0 && after.every((l) => l.issued >= l.requested)
    let opened = false
    if (fulfilled && wo.status === 'PENDING_MATERIAL') {
      await prisma.workOrder.update({ where: { id }, data: { status: 'OPEN' } })
      opened = true
      // Mở WO = xưởng sắp làm → đảm bảo task báo cáo khối lượng tuần (P5.2) đã tồn tại.
      // Tương đương việc hoàn thành P4.5 ở luồng cũ.
      await ensureWeeklyReportTask(wo.projectId, user.userId).catch((e) =>
        console.error('[material-issue] ensureWeeklyReportTask:', e))
    }

    await logAudit(user.userId, 'ISSUE_MATERIAL', 'WorkOrder', id,
      { woCode: wo.woCode, lines: wanted, fulfilled, opened }, getClientIP(req))

    const msg = opened
      ? `Đã cấp đủ vật tư — ${wo.woCode} chuyển sang "Chờ" để xưởng nhận lệnh`
      : fulfilled
        ? `Đã cấp đủ vật tư cho ${wo.woCode}`
        : `Đã cấp ${wanted.length} vật tư cho ${wo.woCode} — vẫn còn thiếu`
    return successResponse({ lines: after, fulfilled, opened }, msg)
  } catch (err) {
    console.error('POST /api/production/[id]/material-issue error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
