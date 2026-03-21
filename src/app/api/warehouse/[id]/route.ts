'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/warehouse/:id — Material detail + movement history
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { id } = await params

    const material = await prisma.material.findUnique({
      where: { id },
      include: {
        stockMovements: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    })

    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    return successResponse({
      material: {
        ...material,
        minStock: Number(material.minStock),
        currentStock: Number(material.currentStock),
        unitPrice: material.unitPrice ? Number(material.unitPrice) : null,
        stockMovements: material.stockMovements.map((sm) => ({
          ...sm,
          quantity: Number(sm.quantity),
        })),
      },
    })
  } catch (err) {
    console.error('GET /api/warehouse/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/warehouse/:id — Update material info
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R05'].includes(payload.roleCode)) {
      return errorResponse('Không có quyền', 403)
    }

    const { id } = await params
    const body = await req.json()

    const material = await prisma.material.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.unit && { unit: body.unit }),
        ...(body.category && { category: body.category }),
        ...(body.minStock !== undefined && { minStock: parseFloat(body.minStock) }),
        ...(body.unitPrice !== undefined && { unitPrice: body.unitPrice ? parseFloat(body.unitPrice) : null }),
      },
    })

    return successResponse({ material })
  } catch (err) {
    console.error('PUT /api/warehouse/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/warehouse/:id — Record stock movement (IN/OUT/RETURN)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R05', 'R06'].includes(payload.roleCode)) {
      return errorResponse('Không có quyền xuất/nhập kho', 403)
    }

    const { id } = await params
    const body = await req.json()
    const { type, quantity, reason, referenceNo, projectId, notes } = body

    if (!type || !quantity || !reason) {
      return errorResponse('Thiếu thông tin: loại (IN/OUT/RETURN), số lượng, lý do')
    }

    if (!['IN', 'OUT', 'RETURN'].includes(type)) {
      return errorResponse('Loại phải là IN, OUT hoặc RETURN')
    }

    const material = await prisma.material.findUnique({ where: { id } })
    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    const qty = parseFloat(quantity)
    if (qty <= 0) return errorResponse('Số lượng phải > 0')

    // Check stock for OUT
    if (type === 'OUT' && Number(material.currentStock) < qty) {
      return errorResponse(`Tồn kho không đủ. Hiện có: ${material.currentStock} ${material.unit}`)
    }

    // Calculate new stock
    const stockDelta = type === 'OUT' ? -qty : qty

    const [movement] = await prisma.$transaction([
      prisma.stockMovement.create({
        data: {
          materialId: id,
          projectId: projectId || null,
          type,
          quantity: qty,
          reason,
          referenceNo: referenceNo || null,
          performedBy: payload.userId,
          notes: notes || null,
        },
      }),
      prisma.material.update({
        where: { id },
        data: { currentStock: { increment: stockDelta } },
      }),
    ])

    return successResponse(
      { movement: { ...movement, quantity: Number(movement.quantity) } },
      `${type === 'IN' ? 'Nhập' : type === 'OUT' ? 'Xuất' : 'Trả'} kho thành công`,
      201,
    )
  } catch (err) {
    console.error('POST /api/warehouse/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
