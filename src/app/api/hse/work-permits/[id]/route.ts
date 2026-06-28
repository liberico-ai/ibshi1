import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateWorkPermitSchema } from '@/lib/schemas'

const APPROVE_ROLES = ['R01', 'R10']
const WRITE_ROLES = ['R01', 'R10', 'R06', 'R06a']

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, WRITE_ROLES)) return errorResponse('Không có quyền', 403)

  const { id } = await params
  const result = await validateBody(req, updateWorkPermitSchema)
  if (!result.success) return result.response
  const data = result.data

  const permit = await prisma.workPermit.findUnique({ where: { id } })
  if (!permit) return errorResponse('Giấy phép không tồn tại', 404)

  if (data.status === 'APPROVED' && !requireRoles(user.roleCode, APPROVE_ROLES)) {
    return errorResponse('Chỉ R01/R10 được duyệt giấy phép', 403)
  }

  const updated = await prisma.workPermit.update({
    where: { id },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(data.status === 'APPROVED' ? { approvedBy: user.userId, approvedAt: new Date() } : {}),
      ...(data.status === 'CLOSED' ? { closedBy: user.userId, closedAt: new Date() } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
      workOrder: { select: { woCode: true } },
    },
  })

  return successResponse({ permit: updated })
}
