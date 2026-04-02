'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

// GET /api/production/:id — Work order detail + material issues
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        materialIssues: {
          orderBy: { issuedAt: 'desc' },
        },
      },
    })

    if (!wo) return errorResponse('Không tìm thấy lệnh sản xuất', 404)

    return successResponse({
      workOrder: {
        ...wo,
        materialIssues: wo.materialIssues.map((mi) => ({
          ...mi,
          quantity: Number(mi.quantity),
        })),
      },
    })
  } catch (err) {
    console.error('GET /api/production/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/production/:id — Update WO status (start, complete, cancel)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R06', 'R06b'].includes(payload.roleCode)) {
      return errorResponse('Không có quyền', 403)
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const body = await req.json()
    const { action } = body

    const wo = await prisma.workOrder.findUnique({ where: { id } })
    if (!wo) return errorResponse('Không tìm thấy WO', 404)

    const updates: Record<string, unknown> = {}

    switch (action) {
      case 'start':
        if (wo.status !== 'OPEN') return errorResponse('WO phải ở trạng thái OPEN để bắt đầu')
        updates.status = 'IN_PROGRESS'
        updates.actualStart = new Date()
        break
      case 'complete':
        if (wo.status !== 'IN_PROGRESS') return errorResponse('WO phải đang IN_PROGRESS để hoàn thành')
        updates.status = 'COMPLETED'
        updates.actualEnd = new Date()
        break
      case 'cancel':
        if (wo.status === 'COMPLETED') return errorResponse('Không thể hủy WO đã hoàn thành')
        updates.status = 'CANCELLED'
        break
      default:
        return errorResponse('Action phải là: start, complete, cancel')
    }

    const updated = await prisma.workOrder.update({ where: { id }, data: updates })
    return successResponse({ workOrder: updated })
  } catch (err) {
    console.error('PUT /api/production/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/production/:id — Issue material to WO
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R05', 'R06'].includes(payload.roleCode)) {
      return errorResponse('Không có quyền cấp vật tư', 403)
    }

    const pResult2 = validateParams(await params, idParamSchema)
    if (!pResult2.success) return pResult2.response
    const { id } = pResult2.data
    const body = await req.json()
    const { materialId, quantity, notes } = body

    if (!materialId || !quantity) {
      return errorResponse('Thiếu: vật tư, số lượng')
    }

    const wo = await prisma.workOrder.findUnique({ where: { id } })
    if (!wo) return errorResponse('Không tìm thấy WO', 404)
    if (wo.status === 'COMPLETED' || wo.status === 'CANCELLED') {
      return errorResponse('Không thể cấp vật tư cho WO đã hoàn thành/hủy')
    }

    const material = await prisma.material.findUnique({ where: { id: materialId } })
    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    const qty = parseFloat(quantity)
    if (qty <= 0) return errorResponse('Số lượng phải > 0')
    if (Number(material.currentStock) < qty) {
      return errorResponse(`Tồn kho không đủ. Hiện có: ${material.currentStock} ${material.unit}`)
    }

    // Atomic: create issue + stock movement + update stock
    const [issue] = await prisma.$transaction([
      prisma.materialIssue.create({
        data: {
          workOrderId: id,
          materialId,
          quantity: qty,
          issuedBy: payload.userId,
          notes: notes || null,
        },
      }),
      prisma.stockMovement.create({
        data: {
          materialId,
          projectId: wo.projectId,
          type: 'OUT',
          quantity: qty,
          reason: 'production_issue',
          referenceNo: wo.woCode,
          performedBy: payload.userId,
          notes: `Cấp cho WO ${wo.woCode}`,
        },
      }),
      prisma.material.update({
        where: { id: materialId },
        data: { currentStock: { decrement: qty } },
      }),
    ])

    return successResponse(
      { materialIssue: { ...issue, quantity: Number(issue.quantity) } },
      'Cấp vật tư thành công',
      201,
    )
  } catch (err) {
    console.error('POST /api/production/:id error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
