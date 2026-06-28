import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateIncidentSchema } from '@/lib/schemas'

const WRITE_ROLES = ['R01', 'R10', 'R06']

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, WRITE_ROLES)) return errorResponse('Không có quyền', 403)

  const { id } = await params
  const result = await validateBody(req, updateIncidentSchema)
  if (!result.success) return result.response
  const data = result.data

  const incident = await prisma.safetyIncident.findUnique({ where: { id } })
  if (!incident) return errorResponse('Sự cố không tồn tại', 404)

  const updated = await prisma.safetyIncident.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.status === 'INVESTIGATING' ? { investigatedBy: data.investigatedBy || user.userId, investigationDate: new Date() } : {}),
      ...(data.status === 'CLOSED' ? { closedBy: user.userId, closedAt: new Date(), resolvedAt: new Date() } : {}),
      ...(data.rootCause !== undefined ? { rootCause: data.rootCause } : {}),
      ...(data.correctiveAction !== undefined ? { correctiveAction: data.correctiveAction } : {}),
      ...(data.lostTimeDays !== undefined ? { lostTimeDays: data.lostTimeDays } : {}),
    },
    include: { project: { select: { projectCode: true, projectName: true } } },
  })

  return successResponse({ incident: updated })
}
