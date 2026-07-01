import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { mergeMaterialsSchema } from '@/lib/schemas'
import { RBAC } from '@/lib/rbac-rules'

export const dynamic = 'force-dynamic'

// POST /api/materials/merge
// Merge duplicate material codes into one survivor. HIGH-RISK: reassigns every
// FK referencing the duplicates, folds stock into the survivor, turns the
// duplicate codes into aliases, and archives the duplicates. Atomic transaction.
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!RBAC.MATERIAL_CODE_MERGE.includes(payload.roleCode)) {
      return forbiddenResponse('Chỉ BGĐ/Admin được gộp mã vật tư')
    }

    const result = await validateBody(req, mergeMaterialsSchema)
    if (!result.success) return result.response
    const { survivorId, duplicateIds } = result.data

    if (duplicateIds.includes(survivorId)) {
      return errorResponse('Mã giữ lại không được nằm trong danh sách mã trùng', 400)
    }

    const ids = [survivorId, ...duplicateIds]
    const found = await prisma.material.findMany({ where: { id: { in: ids } }, select: { id: true } })
    if (found.length !== ids.length) return errorResponse('Một số mã vật tư không tồn tại', 404)

    await prisma.$transaction(async (tx) => {
      const dups = await tx.material.findMany({
        where: { id: { in: duplicateIds } },
        select: { id: true, materialCode: true, currentStock: true, reservedStock: true },
      })

      // 1) reassign every FK referencing the duplicates → survivor
      const reassign = { where: { materialId: { in: duplicateIds } }, data: { materialId: survivorId } }
      await tx.stockMovement.updateMany(reassign)
      await tx.bomItem.updateMany(reassign)
      await tx.purchaseOrderItem.updateMany(reassign)
      await tx.purchaseRequestItem.updateMany(reassign)
      await tx.materialIssue.updateMany(reassign)
      await tx.millCertificate.updateMany(reassign)
      await tx.materialCodeAlias.updateMany(reassign)

      // 2) fold MaterialStock per-warehouse into survivor (upsert increment)
      const dupStocks = await tx.materialStock.findMany({
        where: { materialId: { in: duplicateIds } },
      })
      for (const ds of dupStocks) {
        await tx.materialStock.upsert({
          where: { materialId_warehouseId: { materialId: survivorId, warehouseId: ds.warehouseId } },
          create: { materialId: survivorId, warehouseId: ds.warehouseId, quantity: ds.quantity, value: ds.value },
          update: { quantity: { increment: ds.quantity }, value: { increment: ds.value } },
        })
      }
      await tx.materialStock.deleteMany({ where: { materialId: { in: duplicateIds } } })

      // 3) fold scalar totals + alias + archive
      let stockSum = 0
      let reservedSum = 0
      for (const d of dups) {
        stockSum += Number(d.currentStock)
        reservedSum += Number(d.reservedStock)
        await tx.materialCodeAlias.create({
          data: { materialId: survivorId, aliasCode: d.materialCode, source: 'MANUAL', note: `merged from ${d.materialCode}`, createdBy: payload.userId },
        })
        await tx.material.update({
          where: { id: d.id },
          data: { status: 'ARCHIVE', isProvisional: false, currentStock: 0, reservedStock: 0 },
        })
      }
      if (stockSum !== 0 || reservedSum !== 0) {
        await tx.material.update({
          where: { id: survivorId },
          data: { currentStock: { increment: stockSum }, reservedStock: { increment: reservedSum } },
        })
      }
    })

    await logAudit(payload.userId, 'MERGE', 'Material', survivorId, { duplicateIds }, getClientIP(req))
    return successResponse({ survivorId, mergedCount: duplicateIds.length }, `Đã gộp ${duplicateIds.length} mã vào mã giữ lại`)
  } catch (err) {
    console.error('POST /api/materials/merge error:', err)
    return errorResponse('Lỗi khi gộp mã vật tư', 500)
  }
}
