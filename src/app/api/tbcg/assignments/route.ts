import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createAssignmentSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R10', 'R13', 'R06']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const equipmentId = url.searchParams.get('equipmentId') || undefined
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (equipmentId) where.equipmentId = equipmentId
  if (status) where.status = status

  const assignments = await prisma.equipmentAssignment.findMany({
    where,
    include: {
      equipment: { select: { equipmentCode: true, name: true, category: true } },
      workOrder: { select: { woCode: true, description: true } },
      department: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ assignments })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createAssignmentSchema)
  if (!result.success) return result.response
  const data = result.data

  const eq = await prisma.equipment.findUnique({ where: { id: data.equipmentId } })
  if (!eq) return errorResponse('Thiết bị không tồn tại', 404)

  const activeAssignment = await prisma.equipmentAssignment.findFirst({
    where: { equipmentId: data.equipmentId, status: 'ACTIVE' },
  })
  if (activeAssignment) {
    await prisma.equipmentAssignment.update({
      where: { id: activeAssignment.id },
      data: { status: 'RETURNED', assignedTo: new Date() },
    })
  }

  const assignment = await prisma.$transaction(async (tx) => {
    const a = await tx.equipmentAssignment.create({
      data: {
        equipmentId: data.equipmentId,
        workOrderId: data.workOrderId || null,
        departmentId: data.departmentId || null,
        assignedTo: data.assignedTo ? new Date(data.assignedTo) : null,
        notes: data.notes || null,
        createdBy: user.userId,
      },
      include: {
        equipment: { select: { equipmentCode: true, name: true } },
        workOrder: { select: { woCode: true } },
        department: { select: { code: true, name: true } },
      },
    })
    await tx.equipment.update({
      where: { id: data.equipmentId },
      data: { status: 'IN_USE' },
    })
    return a
  })

  return successResponse({ assignment }, undefined, 201)
}
