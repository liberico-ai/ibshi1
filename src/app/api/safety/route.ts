import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/safety — list safety incidents with summary
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const severity = searchParams.get('severity')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (severity) where.severity = severity
    if (status) where.status = status

    const incidents = await prisma.safetyIncident.findMany({
      where,
      include: { project: { select: { projectCode: true, projectName: true } } },
      orderBy: { incidentDate: 'desc' },
    })

    const stats = await prisma.safetyIncident.groupBy({ by: ['severity'], _count: true })

    return successResponse({
      incidents,
      total: incidents.length,
      stats: stats.reduce((acc: Record<string, number>, s) => ({ ...acc, [s.severity]: s._count }), {}),
    })
  } catch (err) {
    console.error('GET /api/safety error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/safety — report safety incident
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { projectId, incidentDate, severity, category, location, description, rootCause, correctiveAction } = body

    if (!projectId || !incidentDate || !severity || !category || !description) {
      return errorResponse('Thiếu thông tin bắt buộc')
    }

    const year = new Date().getFullYear().toString().slice(-2)
    const count = await prisma.safetyIncident.count()
    const incidentCode = `HSE-${year}-${String(count + 1).padStart(3, '0')}`

    const incident = await prisma.safetyIncident.create({
      data: {
        incidentCode, projectId, severity, category,
        incidentDate: new Date(incidentDate),
        location: location || null, description,
        rootCause: rootCause || null,
        correctiveAction: correctiveAction || null,
        reportedBy: user.userId,
      },
    })

    return successResponse({ incident }, 'Đã báo cáo sự cố an toàn')
  } catch (err) {
    console.error('POST /api/safety error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
