import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createJobCardSchema } from '@/lib/schemas'

// GET /api/production/job-cards — List job cards
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const woId = url.searchParams.get('workOrderId') || undefined
  const teamCode = url.searchParams.get('teamCode') || undefined
  const status = url.searchParams.get('status') || undefined
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')

  const where: Record<string, unknown> = {}
  if (woId) where.workOrderId = woId
  if (teamCode) where.teamCode = teamCode
  if (status) where.status = status

  const [total, jobCards] = await Promise.all([
    prisma.jobCard.count({ where }),
    prisma.jobCard.findMany({
      where,
      include: {
        workOrder: { select: { woCode: true, description: true, projectId: true } },
      },
      orderBy: { workDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  const result = jobCards.map(jc => ({
    ...jc,
    plannedQty: jc.plannedQty ? Number(jc.plannedQty) : null,
    actualQty: jc.actualQty ? Number(jc.actualQty) : null,
  }))

  return successResponse({
    jobCards: result,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

// POST /api/production/job-cards — Create job card (daily input by team leader)
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R06', 'R06a', 'R06b'])) {
    return errorResponse('Không có quyền tạo phiếu công việc', 403)
  }

  const result = await validateBody(req, createJobCardSchema)
  if (!result.success) return result.response
  const { workOrderId, workType, description, plannedQty, unit, workDate, manpower, notes } = result.data

  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  if (!wo) return errorResponse('Không tìm thấy WO')
  if (['COMPLETED', 'CANCELLED'].includes(wo.status)) {
    return errorResponse('WO đã hoàn thành hoặc hủy')
  }

  // Auto-generate job code
  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.jobCard.count()
  const jobCode = `JC-${year}-${String(count + 1).padStart(3, '0')}`

  const jobCard = await prisma.jobCard.create({
    data: {
      jobCode,
      workOrderId,
      teamCode: wo.teamCode,
      workType,
      description: description || `${workType} — ${wo.woCode}`,
      plannedQty: plannedQty || null,
      actualQty: null,
      unit: unit || 'kg',
      workDate: new Date(workDate),
      manpower: manpower || null,
      status: 'IN_PROGRESS',
      reportedBy: user.userId,
      notes: notes || null,
    },
    include: {
      workOrder: { select: { woCode: true } },
    },
  })

  return successResponse({
    jobCard: { ...jobCard, plannedQty: Number(jobCard.plannedQty), actualQty: Number(jobCard.actualQty) },
    message: `Đã tạo phiếu ${jobCode}`,
  })
}
