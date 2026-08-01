import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// Danh mục dự án đang theo dõi (auto) — % hoàn thành (task DONE/tổng) + số ngày còn lại (R-days) + PM.
const VIEW_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a', 'R10']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, VIEW_ROLES)) return errorResponse('Không có quyền xem tiến độ dự án', 403)

  const projects = await prisma.project.findMany({
    where: { status: { not: 'CLOSED' } },
    select: { id: true, projectCode: true, projectName: true, projectType: true, status: true, startDate: true, endDate: true, pmUserId: true },
    orderBy: { createdAt: 'desc' },
  })
  const ids = projects.map(p => p.id)
  if (ids.length === 0) return successResponse({ projects: [] })

  const [totalByProj, doneByProj, pms] = await Promise.all([
    prisma.task.groupBy({ by: ['projectId'], _count: { _all: true }, where: { projectId: { in: ids } } }),
    prisma.task.groupBy({ by: ['projectId'], _count: { _all: true }, where: { projectId: { in: ids }, status: 'DONE' } }),
    prisma.user.findMany({ where: { id: { in: projects.map(p => p.pmUserId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } }),
  ])
  const totalMap = new Map(totalByProj.map(t => [t.projectId, t._count._all]))
  const doneMap = new Map(doneByProj.map(t => [t.projectId, t._count._all]))
  const pmMap = new Map(pms.map(u => [u.id, u.fullName]))

  const now = Date.now()
  const DAY = 86400000
  const out = projects.map(p => {
    const total = totalMap.get(p.id) || 0
    const done = doneMap.get(p.id) || 0
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    const rDays = p.endDate ? Math.round((new Date(p.endDate).getTime() - now) / DAY) : null
    return {
      id: p.id, projectCode: p.projectCode, projectName: p.projectName,
      projectType: p.projectType, status: p.status,
      startDate: p.startDate, endDate: p.endDate,
      pmName: p.pmUserId ? (pmMap.get(p.pmUserId) || null) : null,
      taskDone: done, taskTotal: total, pct, rDays,
    }
  })
  return successResponse({ projects: out })
}
