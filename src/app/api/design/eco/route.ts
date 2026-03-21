import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// GET /api/design/eco — List ECOs
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status

  const ecos = await prisma.engineeringChangeOrder.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ ecos })
}

// POST /api/design/eco — Create ECO
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R04', 'R02', 'R06'])) {
    return errorResponse('Không có quyền tạo ECO', 403)
  }

  const body = await req.json()
  const { projectId, title, description, changeType, impactCost, impactSchedule } = body

  if (!projectId || !title || !description || !changeType) {
    return errorResponse('Thiếu: dự án, tiêu đề, mô tả, loại thay đổi')
  }

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.engineeringChangeOrder.count()
  const ecoCode = `ECO-${year}-${String(count + 1).padStart(3, '0')}`

  const eco = await prisma.engineeringChangeOrder.create({
    data: {
      ecoCode, projectId, title, description, changeType,
      impactCost: impactCost || null,
      impactSchedule: impactSchedule || null,
      requestedBy: user.userId,
    },
  })

  return successResponse({ eco, message: 'Đã tạo ECO' })
}
