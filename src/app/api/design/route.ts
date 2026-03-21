import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// GET /api/design — List drawings
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const status = url.searchParams.get('status') || undefined
  const discipline = url.searchParams.get('discipline') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (status) where.status = status
  if (discipline) where.discipline = discipline

  const drawings = await prisma.drawing.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      revisions: { orderBy: { issuedDate: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ drawings })
}

// POST /api/design — Create drawing
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R04', 'R02'])) {
    return errorResponse('Không có quyền tạo bản vẽ', 403)
  }

  const body = await req.json()
  const { projectId, title, discipline } = body

  if (!projectId || !title || !discipline) {
    return errorResponse('Thiếu: dự án, tiêu đề, loại bản vẽ')
  }

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.drawing.count()
  const drawingCode = `DWG-${year}-${String(count + 1).padStart(3, '0')}`

  const drawing = await prisma.drawing.create({
    data: {
      drawingCode, projectId, title, discipline,
      drawnBy: user.userId,
    },
    include: { project: { select: { projectCode: true, projectName: true } } },
  })

  return successResponse({ drawing, message: 'Đã tạo bản vẽ' })
}
