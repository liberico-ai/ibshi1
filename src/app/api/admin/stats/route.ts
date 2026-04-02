import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse } from '@/lib/auth'
import { withCache } from '@/lib/cache'

const ADMIN_ROLES = ['R01', 'R10']

// GET /api/admin/stats — System dashboard statistics
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!ADMIN_ROLES.includes(payload.roleCode)) return forbiddenResponse()

    const data = await withCache('admin:stats', 120, async () => {
      const [
        totalUsers,
        activeUsers,
        inactiveUsers,
        usersByRole,
        usersByDept,
        recentLogs,
        totalProjects,
        activeProjects,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ where: { isActive: false } }),
        prisma.user.groupBy({ by: ['roleCode'], _count: true, orderBy: { roleCode: 'asc' } }),
        prisma.user.groupBy({ by: ['departmentId'], _count: true }),
        prisma.auditLog.findMany({
          take: 20,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { username: true, fullName: true } } },
        }),
        prisma.project.count(),
        prisma.project.count({ where: { status: 'ACTIVE' } }),
      ])

      // Resolve department names for dept grouping
      const deptIds = usersByDept.map(d => d.departmentId).filter(Boolean) as string[]
      const depts = await prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, code: true, name: true },
      })
      const deptMap = new Map(depts.map(d => [d.id, d]))

      const usersByDeptNamed = usersByDept.map(d => ({
        departmentCode: d.departmentId ? deptMap.get(d.departmentId)?.code || '?' : 'N/A',
        departmentName: d.departmentId ? deptMap.get(d.departmentId)?.name || 'Unknown' : 'Chưa phân bổ',
        count: d._count,
      }))

      return {
        stats: {
          totalUsers,
          activeUsers,
          inactiveUsers,
          totalProjects,
          activeProjects,
          usersByRole: usersByRole.map(r => ({ roleCode: r.roleCode, count: r._count })),
          usersByDept: usersByDeptNamed,
          recentLogs: recentLogs.map(l => ({
            id: l.id,
            action: l.action,
            entity: l.entity,
            entityId: l.entityId,
            username: l.user.username,
            fullName: l.user.fullName,
            createdAt: l.createdAt,
          })),
        },
      }
    })

    return successResponse(data)
  } catch (err) {
    console.error('GET /api/admin/stats error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
