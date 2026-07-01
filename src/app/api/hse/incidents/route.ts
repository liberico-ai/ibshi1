import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { createModuleTask } from '@/lib/module-tasks'

const WRITE_ROLES = ['R01', 'R10', 'R06']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const severity = url.searchParams.get('severity') || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (severity) where.severity = severity

  const incidents = await prisma.safetyIncident.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
    },
    orderBy: { incidentDate: 'desc' },
  })

  return successResponse({ incidents })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, WRITE_ROLES)) return errorResponse('Không có quyền', 403)

  const body = await req.json()
  const { projectId, severity, category, location, description, incidentDate } = body

  if (!projectId || !severity || !category || !description) {
    return errorResponse('Thiếu trường bắt buộc')
  }

  const count = await prisma.safetyIncident.count()
  const year = new Date().getFullYear().toString().slice(-2)
  const incidentCode = `INC-${year}-${String(count + 1).padStart(3, '0')}`

  const incident = await prisma.safetyIncident.create({
    data: {
      incidentCode,
      projectId,
      incidentDate: incidentDate ? new Date(incidentDate) : new Date(),
      severity,
      category,
      location: location || null,
      description,
      reportedBy: user.userId,
    },
    include: { project: { select: { projectCode: true, projectName: true } } },
  })

  const assigneeRoles = ['R09']
  if (projectId) {
    const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { pmUserId: true } })
    if (proj?.pmUserId) assigneeRoles.push('R02')
  }
  if (severity === 'MAJOR' || severity === 'CRITICAL') assigneeRoles.push('R01')

  const hoursToDeadline = severity === 'MINOR' ? 48 : 24
  const deadline = new Date(Date.now() + hoursToDeadline * 60 * 60 * 1000).toISOString()

  const taskId = await createModuleTask('HSE', incident.id, {
    projectId,
    taskType: 'HSE_INVESTIGATION',
    title: `Điều tra sự cố ${incidentCode} — ${category} [${severity}]`,
    description,
    priority: severity === 'CRITICAL' ? 'URGENT' : severity === 'MAJOR' ? 'HIGH' : 'NORMAL',
    deadline,
    assigneeRoles,
  }, user.userId)

  if (taskId) {
    await prisma.safetyIncident.update({ where: { id: incident.id }, data: { taskId } })
  }

  const final = await prisma.safetyIncident.findUniqueOrThrow({
    where: { id: incident.id },
    include: { project: { select: { projectCode: true, projectName: true } } },
  })

  return successResponse({ incident: final }, undefined, 201)
}
