import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createWorkPermitSchema } from '@/lib/schemas'

const WRITE_ROLES = ['R01', 'R10', 'R06', 'R06a']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const permitType = url.searchParams.get('permitType') || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (permitType) where.permitType = permitType

  const permits = await prisma.workPermit.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      workOrder: { select: { woCode: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ permits })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, WRITE_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createWorkPermitSchema)
  if (!result.success) return result.response
  const data = result.data

  const count = await prisma.workPermit.count()
  const permitCode = `PTW-${String(count + 1).padStart(4, '0')}`

  const permit = await prisma.workPermit.create({
    data: {
      permitCode,
      permitType: data.permitType || 'HOT_WORK',
      projectId: data.projectId || null,
      workOrderId: data.workOrderId || null,
      location: data.location || null,
      description: data.description,
      hazards: data.hazards || null,
      precautions: data.precautions || null,
      validFrom: new Date(data.validFrom),
      validTo: new Date(data.validTo),
      requestedBy: user.userId,
      notes: data.notes || null,
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      workOrder: { select: { woCode: true } },
    },
  })

  return successResponse({ permit }, undefined, 201)
}
