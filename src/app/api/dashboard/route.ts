import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getProjectsOverview, getModuleStats } from '@/lib/task-engine'
import { getDynamicDashboardStats, getDynamicBottleneck, getMyDynamicTasks } from '@/lib/work-analytics'
import { withCache } from '@/lib/cache'

// GET /api/dashboard — Dashboard data (hệ động). Stats/bottleneck/myTasks đọc từ Task động.
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const data = await withCache(`dashboard:v2:${payload.userId}`, 60, async () => {
      const [stats, projects, bottleneck, modules, myTasks] = await Promise.all([
        getDynamicDashboardStats(payload.userId, payload.roleCode),
        getProjectsOverview(),
        getDynamicBottleneck(),
        getModuleStats(),
        getMyDynamicTasks(payload.userId, payload.roleCode),
      ])
      return { stats, projects, bottleneck, modules, myTasks }
    })

    return successResponse(data)
  } catch (err) {
    console.error('GET /api/dashboard error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
