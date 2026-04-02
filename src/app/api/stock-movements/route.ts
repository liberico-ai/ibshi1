

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { RBAC } from '@/lib/rbac-rules'

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

    const body = await req.json()
    const { materialId, type, quantity, reason, referenceCode, heatNumber, lotNumber } = body

    if (!materialId || !type || !quantity) {
      return errorResponse('Thiếu thông tin: vật tư, loại (IN/OUT), số lượng')
    }

    if (!['IN', 'OUT', 'ADJUSTMENT'].includes(type)) {
      return errorResponse('Loại phải là IN, OUT, hoặc ADJUSTMENT')
    }

    const material = await prisma.material.findUnique({ where: { id: materialId } })
    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    const qty = parseFloat(quantity)
    if (type === 'OUT' && Number(material.currentStock) < qty) {
      return errorResponse(`Không đủ tồn kho. Hiện có: ${material.currentStock}, yêu cầu: ${qty}`)
    }

    // Create movement + update stock in transaction
    const result = await prisma.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          materialId,
          type,
          quantity: qty,
          reason: reason || (type === 'IN' ? 'Nhập kho' : 'Xuất kho'),
          referenceNo: referenceCode || null,
          heatNumber: heatNumber || null,
          lotNumber: lotNumber || null,
          performedBy: payload.userId,
        },
      })

      const stockChange = type === 'OUT' ? -qty : qty
      await tx.material.update({
        where: { id: materialId },
        data: { currentStock: { increment: stockChange } },
      })

      return movement
    })

    return successResponse({ movement: result },
      type === 'IN' ? `Đã nhập ${qty} ${material.unit}` : `Đã xuất ${qty} ${material.unit}`,
      201)
  } catch (err) {
    console.error('POST /api/stock-movements error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
