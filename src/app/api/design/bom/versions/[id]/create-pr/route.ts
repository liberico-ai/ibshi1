import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { computeImpact } from '@/lib/bom-diff-engine'
import type { ImpactLine } from '@/lib/bom-diff-engine'
import { PR_EDIT_ROLES } from '@/lib/constants'

/**
 * POST /api/design/bom/versions/:id/create-pr — ECO auto-apply (Đợt2-A)
 *
 * Tự đề xuất + tạo PR bổ sung từ impact của BOM version (thay vì người dùng gõ tay từng dòng):
 * - Version phải ACTIVE (đã duyệt) + gắn ECO — nếu không → 422.
 * - Baseline = bản SUPERSEDED versionNo lớn nhất (bản trước) của cùng BOM — không có → 422.
 * - computeImpact(id, baselineId) → lọc dòng cần mua: suggestedActionCode ∈ {ADD_PR, UPDATE_PR}
 *   (đúng bộ code "needPurchase" trong bom-diff-engine) VÀ qtyDelta > 0.
 * - Idempotent: đã có PurchaseRequest originType='ECO' originId=<bomVersionId> → trả PR cũ (existing:true).
 *   originId = bomVersionId — NHẤT QUÁN với cascade-tasks.buildProcurementOriginBlock,
 *   nút "Tạo PR bổ sung" thủ công trên trang BOM version, và comment schema PurchaseRequest.originId.
 * - Dòng ALERT_PO (vật tư đã đặt PO) → chỉ trả về poAlerts để cảnh báo TM, KHÔNG đụng PO.
 */

const BUY_ACTION_CODES: ImpactLine['suggestedActionCode'][] = ['ADD_PR', 'UPDATE_PR']

function toPoAlert(line: ImpactLine) {
  return {
    materialId: line.diffLine.materialId,
    materialCode: line.diffLine.materialCode,
    materialName: line.diffLine.materialName,
    pieceMark: line.diffLine.pieceMark,
    qtyDelta: line.diffLine.qtyDelta,
    unit: line.diffLine.unit,
    currentPoQty: line.currentPoQty,
    suggestedAction: line.suggestedAction,
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(PR_EDIT_ROLES as readonly string[]).includes(payload.roleCode)) {
      return errorResponse('Bạn không có quyền tạo yêu cầu mua hàng', 403)
    }

    const { id } = await params

    const version = await prisma.bomVersion.findUnique({
      where: { id },
      include: {
        bom: { select: { id: true, projectId: true } },
        eco: { select: { id: true, ecoCode: true } },
      },
    })
    if (!version) return errorResponse('Không tìm thấy phiên bản BOM', 404)
    if (version.status !== 'ACTIVE') {
      return errorResponse('Chỉ tạo PR bổ sung cho phiên bản đã duyệt (ACTIVE)', 422)
    }
    if (!version.ecoId || !version.eco) {
      return errorResponse('Phiên bản không gắn ECO — không có nguồn thay đổi để tạo PR bổ sung', 422)
    }

    // Idempotent: đã có PR phát sinh từ version này → trả PR cũ, không tạo trùng
    const existing = await prisma.purchaseRequest.findFirst({
      where: { originType: 'ECO', originId: id },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        items: { include: { material: { select: { materialCode: true, name: true, unit: true } } } },
      },
    })
    if (existing) {
      return successResponse(
        { existing: true, created: false, prId: existing.id, prCode: existing.prCode, purchaseRequest: existing },
        `Đã có PR ${existing.prCode} phát sinh từ phiên bản này — không tạo trùng`,
      )
    }

    // Baseline = bản trước: SUPERSEDED versionNo lớn nhất của cùng BOM
    const baseline = await prisma.bomVersion.findFirst({
      where: { bomId: version.bomId, status: 'SUPERSEDED', versionNo: { lt: version.versionNo } },
      orderBy: { versionNo: 'desc' },
      select: { id: true, versionNo: true },
    })
    if (!baseline) {
      return errorResponse('Không có bản trước (SUPERSEDED) để so sánh — không tính được vật tư cần mua thêm', 422)
    }

    const impact = await computeImpact(id, baseline.id)

    const buyLines = impact.lines.filter(
      l => BUY_ACTION_CODES.includes(l.suggestedActionCode) && l.diffLine.qtyDelta > 0,
    )
    const poAlerts = impact.lines.filter(l => l.suggestedActionCode === 'ALERT_PO').map(toPoAlert)

    if (buyLines.length === 0) {
      return successResponse({
        created: false,
        existing: false,
        poAlerts,
        message: 'Không có dòng nào cần mua thêm từ thay đổi này — không tạo PR',
      })
    }

    // Sinh mã PR-YY-NNN — cùng format với POST /api/purchase-requests
    const year = new Date().getFullYear().toString().slice(-2)
    const lastPr = await prisma.purchaseRequest.findFirst({
      where: { prCode: { startsWith: `PR-${year}-` } },
      orderBy: { prCode: 'desc' },
    })
    const seq = lastPr ? parseInt(lastPr.prCode.split('-')[2]) + 1 : 1
    const prCode = `PR-${year}-${String(seq).padStart(3, '0')}`

    const pr = await prisma.purchaseRequest.create({
      data: {
        prCode,
        projectId: version.bom.projectId,
        requestedBy: payload.userId,
        urgency: 'NORMAL',
        status: 'DRAFT',
        notes: `Tự động đề xuất từ ECO ${version.eco.ecoCode} (Rev ${version.versionNo} so với Rev ${baseline.versionNo})`,
        originType: 'ECO',
        originId: id,
        originLabel: version.eco.ecoCode,
        items: {
          create: buyLines.map(l => ({
            materialId: l.diffLine.materialId,
            quantity: l.diffLine.qtyDelta,
            bomVersionId: id,
            notes: l.suggestedAction,
          })),
        },
      },
      include: {
        project: { select: { projectCode: true, projectName: true } },
        items: { include: { material: { select: { materialCode: true, name: true, unit: true } } } },
      },
    })

    return successResponse(
      {
        created: true,
        existing: false,
        prId: pr.id,
        prCode: pr.prCode,
        purchaseRequest: pr,
        items: buyLines.map(l => ({
          materialId: l.diffLine.materialId,
          materialCode: l.diffLine.materialCode,
          materialName: l.diffLine.materialName,
          quantity: l.diffLine.qtyDelta,
          unit: l.diffLine.unit,
          suggestedAction: l.suggestedAction,
        })),
        poAlerts,
      },
      `Đã tạo PR ${prCode} với ${buyLines.length} dòng vật tư cần mua thêm từ ECO ${version.eco.ecoCode}`,
      201,
    )
  } catch (err) {
    console.error('POST /api/design/bom/versions/[id]/create-pr error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
