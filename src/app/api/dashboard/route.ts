import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getDashboardStats, getProjectsOverview, getBottleneckMap, getModuleStats } from '@/lib/task-engine'
import { withCache } from '@/lib/cache'

// GET /api/dashboard — Dashboard data (role-based)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const data = await withCache(`dashboard:${payload.userId}`, 60, async () => {
      const [stats, projects, bottleneck, modules] = await Promise.all([
        getDashboardStats(payload.roleCode),
        getProjectsOverview(),
        getBottleneckMap(),
        getModuleStats(),
      ])
      return { stats, projects, bottleneck, modules }
    })

    return successResponse(data)
  } catch (err) {
    console.error('GET /api/dashboard error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
