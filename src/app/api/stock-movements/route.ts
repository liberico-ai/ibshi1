

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { RBAC } from '@/lib/rbac-rules'
import { cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateBody } from '@/lib/api-helpers'
import { stockMovementSchema } from '@/lib/schemas'
import { applyStockMovement } from '@/lib/stock-ledger'

// GET /api/stock-movements — List stock movements
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const materialId = searchParams.get('materialId')
    const type = searchParams.get('type') // IN, OUT, ADJUSTMENT
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = 30

    const where: Record<string, unknown> = {}
    if (materialId) where.materialId = materialId
    if (type) where.type = type

    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: {
          material: { select: { materialCode: true, name: true, unit: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return successResponse({
      movements: movements.map((m: Record<string, unknown>) => ({ ...m, quantity: Number(m.quantity) })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/stock-movements error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/stock-movements — Create stock movement (nhập/xuất)
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!RBAC.STORE_ACTION.includes(payload.roleCode)) {
      return errorResponse('Chỉ Kho hoặc BGĐ mới được tạo phiếu nhập/xuất', 403)
    }

    const validation = await validateBody(req, stockMovementSchema)
    if (!validation.success) return validation.response
    const { materialId, type, quantity, reason, referenceNo: referenceCode, heatNumber, lotNumber } = validation.data

    const material = await prisma.material.findUnique({ where: { id: materialId } })
    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    const qty = quantity
    if (type === 'OUT' && Number(material.currentStock) < qty) {
      return errorResponse(`Không đủ tồn kho. Hiện có: ${material.currentStock}, yêu cầu: ${qty}`)
    }

    const result = await prisma.$transaction(async (tx) => {
      return applyStockMovement(tx, {
        materialId,
        type: type as 'IN' | 'OUT' | 'RETURN' | 'ADJUSTMENT',
        quantity: qty,
        reason: reason || (type === 'IN' ? 'Nhập kho' : 'Xuất kho'),
        referenceNo: referenceCode,
        heatNumber,
        lotNumber,
        performedBy: payload.userId,
      })
    })

    // Invalidate warehouse cache after stock movement
    await cacheInvalidate(CACHE_KEYS.warehouse)

    return successResponse({ movement: result },
      type === 'IN' ? `Đã nhập ${qty} ${material.unit}` : `Đã xuất ${qty} ${material.unit}`,
      201)
  } catch (err) {
    console.error('POST /api/stock-movements error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
