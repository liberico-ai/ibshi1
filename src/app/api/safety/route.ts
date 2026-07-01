import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R06', 'R06a', 'R09', 'R09a']

// GET /api/safety — list safety incidents (giữ tạm cho backward compat)
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

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

// POST /api/safety — LOCKED: dùng POST /api/hse/incidents thay thế
export async function POST() {
  return errorResponse('API /api/safety đã ngừng nhận dữ liệu mới. Dùng POST /api/hse/incidents.', 410)
}
