import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { z } from 'zod'

const updateEcoSchema = z.object({
  status: z.string().optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  impactCost: z.number().optional().nullable(),
  impactSchedule: z.number().int().optional().nullable(),
})

// GET /api/design/eco/[id] — Get single ECO by id
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params

  const eco = await prisma.engineeringChangeOrder.findUnique({
    where: { id },
    include: {
      project: { select: { projectCode: true, projectName: true } },
    },
  })

  if (!eco) return errorResponse('Không tìm thấy ECO', 404)

  return successResponse({ eco })
}

// PUT /api/design/eco/[id] — Update ECO
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R02', 'R02a'])) {
    return errorResponse('Không có quyền cập nhật ECO', 403)
  }

  const { id } = await params

  const existing = await prisma.engineeringChangeOrder.findUnique({ where: { id } })
  if (!existing) return errorResponse('Không tìm thấy ECO', 404)

  const result = await validateBody(req, updateEcoSchema)
  if (!result.success) return result.response
  const { status, title, description, impactCost, impactSchedule } = result.data

  const data: Record<string, unknown> = {}
  if (title !== undefined) data.title = title
  if (description !== undefined) data.description = description
  if (impactCost !== undefined) data.impactCost = impactCost
  if (impactSchedule !== undefined) data.impactSchedule = impactSchedule

  if (status !== undefined) {
    data.status = status
    if (status === 'APPROVED') {
      data.approvedBy = user.userId
      data.approvedAt = new Date()
    }
    if (status === 'IMPLEMENTED') {
      data.implementedAt = new Date()
    }
  }

  const eco = await prisma.engineeringChangeOrder.update({
    where: { id },
    data,
    include: {
      project: { select: { projectCode: true, projectName: true } },
    },
  })

  return successResponse({ eco, message: 'Đã cập nhật ECO' })
}
