import { NextRequest } from 'next/server'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getProjectOverview, getGeneralTasksOverview } from '@/lib/work-analytics'

export const dynamic = 'force-dynamic'

// GET /api/work/project-overview/[id] — tổng quan điều hành 1 dự án
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const data = id === '__general__' ? await getGeneralTasksOverview() : await getProjectOverview(id)
    if (!data) return errorResponse('Không tìm thấy dự án', 404)
    return successResponse(data)
  } catch (err) {
    console.error('GET /api/work/project-overview/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
