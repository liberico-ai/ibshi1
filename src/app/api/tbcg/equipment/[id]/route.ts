import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateEquipmentSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R10', 'R13', 'R06']

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const { id } = await params
  const result = await validateBody(req, updateEquipmentSchema)
  if (!result.success) return result.response
  const data = result.data

  const eq = await prisma.equipment.findUnique({ where: { id } })
  if (!eq) return errorResponse('Thiết bị không tồn tại', 404)

  const updated = await prisma.equipment.update({
    where: { id },
    data: {
      ...(data.name ? { name: data.name } : {}),
      ...(data.category ? { category: data.category } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.condition ? { condition: data.condition } : {}),
      ...(data.location !== undefined ? { location: data.location } : {}),
      ...(data.departmentId !== undefined ? { departmentId: data.departmentId || null } : {}),
      ...(data.inspectionDue ? { inspectionDue: new Date(data.inspectionDue) } : {}),
      ...(data.lastInspection ? { lastInspection: new Date(data.lastInspection) } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
    include: { department: { select: { code: true, name: true } } },
  })

  return successResponse({ equipment: updated })
}
