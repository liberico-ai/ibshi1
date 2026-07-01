import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { promoteMaterialSchema } from '@/lib/schemas'
import { RBAC } from '@/lib/rbac-rules'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!RBAC.MATERIAL_CODE_PROMOTE.includes(payload.roleCode)) {
      return forbiddenResponse('Không có quyền promote mã vật tư')
    }

    const result = await validateBody(req, promoteMaterialSchema)
    if (!result.success) return result.response
    const { provisionalId, targetId, newCode } = result.data

    const provisional = await prisma.material.findUnique({
      where: { id: provisionalId },
      select: { id: true, materialCode: true, name: true, unit: true, category: true, specification: true, grade: true, nameEn: true, isProvisional: true, status: true, promotedToId: true, currentStock: true, reservedStock: true },
    })
    if (!provisional) return errorResponse('Mã tạm không tồn tại', 404)

    if (provisional.promotedToId || provisional.status === 'ARCHIVE') {
      return successResponse({ alreadyPromoted: true, promotedToId: provisional.promotedToId })
    }

    if (!provisional.isProvisional) {
      return errorResponse('Mã này không phải mã tạm (isProvisional=false)', 400)
    }

    let finalTargetId: string

    if (targetId) {
      if (targetId === provisionalId) {
        return errorResponse('Không thể promote vào chính nó', 400)
      }
      const target = await prisma.material.findUnique({
        where: { id: targetId },
        select: { id: true, isProvisional: true, status: true },
      })
      if (!target) return errorResponse('Mã đích không tồn tại', 404)
      if (target.isProvisional) return errorResponse('Không thể promote vào mã tạm khác', 400)
      if (target.status === 'ARCHIVE' || target.status === 'OBSOLETE') {
        return errorResponse('Mã đích đã lưu trữ/ngừng dùng', 400)
      }
      finalTargetId = targetId
    } else {
      const codeParts = newCode!.split('-')
      if (codeParts.length < 2) return errorResponse('newCode phải có dạng PREFIX-SUBGROUP (vd BAH-AOBH)', 400)
      const [prefix, subgroup] = codeParts

      const created = await prisma.$transaction(async (tx) => {
        const { generateMaterialCode } = await import('@/lib/material-code')
        const code = await generateMaterialCode(tx, prefix, subgroup)
        return tx.material.create({
          data: {
            materialCode: code,
            name: provisional.name,
            nameEn: provisional.nameEn,
            unit: provisional.unit,
            category: prefix,
            specification: provisional.specification,
            grade: provisional.grade,
            status: 'ACTIVE',
            isProvisional: false,
          },
        })
      })
      finalTargetId = created.id
    }

    await prisma.$transaction(async (tx) => {
      const reassign = { where: { materialId: provisionalId }, data: { materialId: finalTargetId } }
      await tx.stockMovement.updateMany(reassign)
      await tx.bomItem.updateMany(reassign)
      await tx.purchaseOrderItem.updateMany(reassign)
      await tx.purchaseRequestItem.updateMany(reassign)
      await tx.materialIssue.updateMany(reassign)
      await tx.millCertificate.updateMany(reassign)
      await tx.materialCodeAlias.updateMany(reassign)

      const provStocks = await tx.materialStock.findMany({
        where: { materialId: provisionalId },
      })
      for (const ps of provStocks) {
        await tx.materialStock.upsert({
          where: { materialId_warehouseId: { materialId: finalTargetId, warehouseId: ps.warehouseId } },
          create: { materialId: finalTargetId, warehouseId: ps.warehouseId, quantity: ps.quantity, value: ps.value },
          update: { quantity: { increment: ps.quantity }, value: { increment: ps.value } },
        })
      }
      await tx.materialStock.deleteMany({ where: { materialId: provisionalId } })

      const stockInc = Number(provisional.currentStock)
      const resInc = Number(provisional.reservedStock)
      if (stockInc !== 0 || resInc !== 0) {
        await tx.material.update({
          where: { id: finalTargetId },
          data: { currentStock: { increment: stockInc }, reservedStock: { increment: resInc } },
        })
      }

      await tx.materialCodeAlias.create({
        data: {
          materialId: finalTargetId,
          aliasCode: provisional.materialCode,
          source: 'MANUAL',
          note: `promoted from ${provisional.materialCode}`,
          createdBy: payload.userId,
        },
      })

      await tx.material.update({
        where: { id: provisionalId },
        data: {
          status: 'ARCHIVE',
          isProvisional: false,
          currentStock: 0,
          reservedStock: 0,
          promotedToId: finalTargetId,
        },
      })
    })

    await logAudit(payload.userId, 'PROMOTE', 'Material', finalTargetId, { provisionalId, provisionalCode: provisional.materialCode }, getClientIP(req))
    return successResponse({ provisionalId, targetId: finalTargetId, provisionalCode: provisional.materialCode })
  } catch (err) {
    console.error('POST /api/materials/promote error:', err)
    return errorResponse('Lỗi khi promote mã vật tư', 500)
  }
}
