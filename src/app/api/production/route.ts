'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { searchFilterSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'

// GET /api/production — List work orders
export const GET = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const qResult = validateQuery(req.url, searchFilterSchema)
  if (!qResult.success) return qResult.response
  const { page, limit, search, status } = qResult.data
  const projectId = new URL(req.url).searchParams.get('projectId')

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (projectId) where.projectId = projectId
  if (search) {
    where.OR = [
      { woCode: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [total, workOrders] = await Promise.all([
    prisma.workOrder.count({ where }),
    prisma.workOrder.findMany({
      where,
      include: {
        materialIssues: {
          select: { id: true, materialId: true, quantity: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  const result = workOrders.map((wo: Record<string, unknown> & { materialIssues: Array<Record<string, unknown>> }) => ({
    id: wo.id,
    woCode: wo.woCode,
    projectId: wo.projectId,
    description: wo.description,
    teamCode: wo.teamCode,
    status: wo.status,
    plannedStart: wo.plannedStart,
    plannedEnd: wo.plannedEnd,
    actualStart: wo.actualStart,
    actualEnd: wo.actualEnd,
    materialIssueCount: wo.materialIssues.length,
    createdAt: wo.createdAt,
  }))

  return successResponse({
    workOrders: result,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
})

// POST /api/production — Create work order
export const POST = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  if (!['R01', 'R06', 'R06b'].includes(payload.roleCode)) {
    return errorResponse('Không có quyền tạo lệnh sản xuất', 403)
  }

  const body = await req.json()
  const { woCode, projectId, description, teamCode, plannedStart, plannedEnd } = body

  if (!woCode || !projectId || !description || !teamCode) {
    return errorResponse('Thiếu: mã WO, dự án, mô tả, tổ SX')
  }

  const existing = await prisma.workOrder.findUnique({ where: { woCode } })
  if (existing) return errorResponse(`Mã WO ${woCode} đã tồn tại`)

  const wo = await prisma.workOrder.create({
    data: {
      woCode,
      projectId,
      description,
      teamCode,
      plannedStart: plannedStart ? new Date(plannedStart) : null,
      plannedEnd: plannedEnd ? new Date(plannedEnd) : null,
      createdBy: payload.userId,
    },
  })

  return successResponse({ workOrder: wo }, 'Lệnh sản xuất đã tạo', 201)
})
