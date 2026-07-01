import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createMaintenanceSchema } from '@/lib/schemas'
import { createModuleTask } from '@/lib/module-tasks'

const ALLOWED_ROLES = ['R01', 'R10', 'R13', 'R06']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const equipmentId = url.searchParams.get('equipmentId') || undefined
  const status = url.searchParams.get('status') || undefined
  const type = url.searchParams.get('type') || undefined

  const where: Record<string, unknown> = {}
  if (equipmentId) where.equipmentId = equipmentId
  if (status) where.status = status
  if (type) where.type = type

  const records = await prisma.maintenanceRecord.findMany({
    where,
    include: {
      equipment: { select: { equipmentCode: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = records.map(r => ({
    ...r,
    cost: r.cost ? Number(r.cost) : null,
  }))

  return successResponse({ maintenanceRecords: result })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createMaintenanceSchema)
  if (!result.success) return result.response
  const data = result.data

  const eq = await prisma.equipment.findUnique({ where: { id: data.equipmentId } })
  if (!eq) return errorResponse('Thiết bị không tồn tại', 404)

  const count = await prisma.maintenanceRecord.count()
  const maintCode = `MT-${String(count + 1).padStart(5, '0')}`

  const record = await prisma.maintenanceRecord.create({
    data: {
      maintCode,
      equipmentId: data.equipmentId,
      type: data.type || 'PREVENTIVE',
      description: data.description,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
      cost: data.cost || null,
      notes: data.notes || null,
      createdBy: user.userId,
    },
    include: { equipment: { select: { equipmentCode: true, name: true } } },
  })

  if (data.type === 'BREAKDOWN') {
    await prisma.equipment.update({
      where: { id: data.equipmentId },
      data: { status: 'MAINTENANCE' },
    })

    const deadline = data.scheduledDate
      ? new Date(data.scheduledDate).toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const taskId = await createModuleTask('TBCG', record.id, {
      taskType: 'TBCG_REPAIR',
      title: `Sửa chữa khẩn cấp ${eq.equipmentCode} — ${eq.name}`,
      description: data.description,
      priority: 'URGENT',
      deadline,
      assigneeRoles: ['R13', 'R06'],
    }, user.userId)

    if (taskId) {
      await prisma.maintenanceRecord.update({ where: { id: record.id }, data: { taskId } })
    }
  }

  const final = await prisma.maintenanceRecord.findUniqueOrThrow({
    where: { id: record.id },
    include: { equipment: { select: { equipmentCode: true, name: true } } },
  })

  return successResponse({ maintenanceRecord: { ...final, cost: final.cost ? Number(final.cost) : null } }, undefined, 201)
}
