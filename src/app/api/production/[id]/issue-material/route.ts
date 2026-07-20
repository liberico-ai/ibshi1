import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { createMaterialIssueSchema, idParamSchema } from '@/lib/schemas'
import { applyStockMovement } from '@/lib/stock-ledger'

// POST /api/production/[id]/issue-material — Issue material for a Work Order
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!(await can(user, 'action.store')) && !(await can(user, 'action.production'))) {
      return errorResponse('Chỉ Kho hoặc SX được cấp phát vật tư', 403)
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const result = await validateBody(req, createMaterialIssueSchema)
    if (!result.success) return result.response
    const { materialId, quantity, heatNumber, notes } = result.data

    // Check WO exists and is active
    const wo = await prisma.workOrder.findUnique({ where: { id } })
    if (!wo) return errorResponse('Work Order không tồn tại', 404)
    if (!['OPEN', 'IN_PROGRESS'].includes(wo.status)) {
      return errorResponse('WO phải ở trạng thái OPEN hoặc IN_PROGRESS để cấp phát VT')
    }

    // Check stock availability
    const material = await prisma.material.findUnique({ where: { id: materialId } })
    if (!material) return errorResponse('Vật tư không tồn tại', 404)
    if (Number(material.currentStock) < quantity) {
      return errorResponse(`Tồn kho không đủ: có ${material.currentStock}, yêu cầu ${quantity}`)
    }

    const movement = await prisma.$transaction(async (tx) => {
      return applyStockMovement(tx, {
        materialId,
        type: 'OUT',
        quantity,
        reason: 'wo_issue',
        referenceNo: wo.woCode,
        heatNumber: heatNumber || null,
        notes: notes || `Cấp phát cho ${wo.woCode}`,
        performedBy: user.userId,
      })
    })

    await logAudit(user.userId, 'ISSUE_MATERIAL', 'WorkOrder', id,
      { woCode: wo.woCode, materialCode: material.materialCode, quantity, heatNumber }, getClientIP(req))

    return successResponse({ movement }, `Đã cấp ${quantity} ${material.unit} cho ${wo.woCode}`, 201)
  } catch (err) {
    console.error('POST /api/production/[id]/issue-material error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
