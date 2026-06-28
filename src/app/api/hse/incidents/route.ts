import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

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

  return successResponse({ incident }, undefined, 201)
}
