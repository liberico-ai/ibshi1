import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/delivery — list deliveries (giữ tạm cho backward compat)
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (status) where.status = status

    const deliveries = await prisma.deliveryRecord.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        workOrder: { select: { woCode: true, description: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({ deliveries })
  } catch (err) {
    console.error('GET /api/delivery error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/delivery — LOCKED: dùng logistics/shipments thay thế
export async function POST() {
  return errorResponse('API /api/delivery đã ngừng nhận dữ liệu mới. Dùng POST /api/logistics/shipments.', 410)
}

// PATCH /api/delivery — LOCKED
export async function PATCH() {
  return errorResponse('API /api/delivery đã ngừng. Dùng /api/logistics/shipments/[id].', 410)
}
