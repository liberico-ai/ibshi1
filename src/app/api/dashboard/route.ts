import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getDashboardStats, getProjectsOverview, getBottleneckMap, getModuleStats } from '@/lib/task-engine'

// GET /api/dashboard — Dashboard data (role-based)
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const [stats, projects, bottleneck, modules] = await Promise.all([
      getDashboardStats(payload.roleCode),
      getProjectsOverview(),
      getBottleneckMap(),
      getModuleStats(),
    ])

    return successResponse({ stats, projects, bottleneck, modules })
  } catch (err) {
    console.error('GET /api/dashboard error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
