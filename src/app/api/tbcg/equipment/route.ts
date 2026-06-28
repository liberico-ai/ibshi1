import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createEquipmentSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R10', 'R13', 'R06']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const departmentId = url.searchParams.get('departmentId') || undefined
  const search = url.searchParams.get('search') || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (departmentId) where.departmentId = departmentId
  if (search) {
    where.OR = [
      { equipmentCode: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ]
  }

  const equipment = await prisma.equipment.findMany({
    where,
    include: {
      department: { select: { code: true, name: true } },
      assignments: {
        where: { status: 'ACTIVE' },
        include: {
          workOrder: { select: { woCode: true } },
          department: { select: { code: true, name: true } },
        },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const now = new Date()
  const result = equipment.map(eq => {
    const dueDate = eq.inspectionDue ? new Date(eq.inspectionDue) : null
    const isOverdue = dueDate && dueDate < now
    const isDueSoon = dueDate && !isOverdue && dueDate.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000
    return {
      ...eq,
      inspectionAlert: isOverdue ? 'OVERDUE' : isDueSoon ? 'DUE_SOON' : null,
      currentAssignment: eq.assignments[0] || null,
    }
  })

  return successResponse({ equipment: result })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createEquipmentSchema)
  if (!result.success) return result.response
  const data = result.data

  const count = await prisma.equipment.count()
  const equipmentCode = `EQ-${String(count + 1).padStart(4, '0')}`

  const eq = await prisma.equipment.create({
    data: {
      equipmentCode,
      name: data.name,
      category: data.category || 'OTHER',
      model: data.model || null,
      serialNo: data.serialNo || null,
      manufacturer: data.manufacturer || null,
      location: data.location || null,
      departmentId: data.departmentId || null,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      inspectionDue: data.inspectionDue ? new Date(data.inspectionDue) : null,
      notes: data.notes || null,
      createdBy: user.userId,
    },
    include: { department: { select: { code: true, name: true } } },
  })

  return successResponse({ equipment: eq }, undefined, 201)
}
