'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'
import { applyStockMovement } from '@/lib/stock-ledger'

// GET /api/production/:id — Work order detail + material issues
export const GET = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
})

// PATCH /api/production/:id — Sửa thông tin WO (mô tả, xưởng, trọng lượng, ngày kế hoạch). Chỉ PM/BGĐ.
export const PATCH = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()
  if (!['R01', 'R02'].includes(payload.roleCode)) return errorResponse('Không có quyền sửa WO', 403)

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id } = pResult.data

  const wo = await prisma.workOrder.findUnique({ where: { id }, select: { id: true } })
  if (!wo) return errorResponse('Không tìm thấy lệnh sản xuất', 404)

  const body = await req.json().catch(() => ({})) as { description?: string; teamCode?: string; plannedWeight?: number | string; plannedStart?: string; plannedEnd?: string; pieceMark?: string }
  const toDate = (v: unknown) => { const s = String(v ?? '').trim(); if (!s) return null; const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d }
  const data: Record<string, unknown> = {}
  if (body.description !== undefined) data.description = String(body.description).trim()
  if (body.pieceMark !== undefined) data.pieceMark = String(body.pieceMark).trim() || null
  if (body.teamCode !== undefined) {
    const tc = String(body.teamCode).trim()
    data.teamCode = tc
    const dept = tc && tc.toUpperCase() !== 'THAUPHU' ? await prisma.department.findFirst({ where: { code: tc }, select: { id: true } }) : null
    data.departmentId = dept?.id || null
  }
  if (body.plannedWeight !== undefined) { const w = Number(body.plannedWeight); data.plannedWeight = Number.isFinite(w) && w > 0 ? w : null }
  if (body.plannedStart !== undefined) data.plannedStart = toDate(body.plannedStart)
  if (body.plannedEnd !== undefined) data.plannedEnd = toDate(body.plannedEnd)

  if (Object.keys(data).length === 0) return errorResponse('Không có trường nào để cập nhật', 400)

  const updated = await prisma.workOrder.update({ where: { id }, data, select: { id: true, woCode: true, description: true, teamCode: true, plannedWeight: true } })
  return successResponse({ workOrder: { ...updated, plannedWeight: updated.plannedWeight ? Number(updated.plannedWeight) : null } }, `Đã cập nhật WO ${updated.woCode}`)
})

// PUT /api/production/:id — Update WO status (start, complete, cancel)
export const PUT = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
})

// POST /api/production/:id — Issue material to WO
export const POST = withErrorHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  if (!['R01', 'R05', 'R06', 'R08', 'R08a'].includes(payload.roleCode)) {
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

  const result = await prisma.$transaction(async (tx) => {
    const issue = await tx.materialIssue.create({
      data: {
        workOrderId: id,
        materialId,
        quantity: qty,
        issuedBy: payload.userId,
        notes: notes || null,
      },
    })
    await applyStockMovement(tx, {
      materialId,
      projectId: wo.projectId,
      type: 'OUT',
      quantity: qty,
      reason: 'production_issue',
      referenceNo: wo.woCode,
      performedBy: payload.userId,
      notes: `Cấp cho WO ${wo.woCode}`,
    })
    return issue
  })
  const issue = result

  return successResponse(
    { materialIssue: { ...issue, quantity: Number(issue.quantity) } },
    'Cấp vật tư thành công',
    201,
  )
})
