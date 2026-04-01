import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/drawings — list drawings with revisions
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const status = searchParams.get('status')
    const discipline = searchParams.get('discipline')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (status) where.status = status
    if (discipline) where.discipline = discipline

    const drawings = await prisma.drawing.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        revisions: { orderBy: { issuedDate: 'desc' }, take: 3 },
      },
      orderBy: { drawingCode: 'asc' },
    })

    const stats = await prisma.drawing.groupBy({ by: ['status'], _count: true })

    return successResponse({
      drawings,
      total: drawings.length,
      stats: stats.reduce((acc: Record<string, number>, s) => ({ ...acc, [s.status]: s._count }), {}),
    })
  } catch (err) {
    console.error('GET /api/drawings error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/drawings — create drawing
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { drawingCode, projectId, title, discipline } = body

    if (!drawingCode || !projectId || !title || !discipline) {
      return errorResponse('Thiếu: drawingCode, projectId, title, discipline')
    }

    const exists = await prisma.drawing.findUnique({ where: { drawingCode } })
    if (exists) return errorResponse(`Mã bản vẽ ${drawingCode} đã tồn tại`)

    const drawing = await prisma.drawing.create({
      data: {
        drawingCode, projectId, title, discipline,
        drawnBy: user.userId,
      },
    })

    // Auto-create initial revision R0
    await prisma.drawingRevision.create({
      data: {
        drawingId: drawing.id,
        revision: 'R0',
        description: 'Initial issue',
        issuedDate: new Date(),
        issuedBy: user.userId,
      },
    })

    return successResponse({ drawing }, 'Tạo bản vẽ thành công')
  } catch (err) {
    console.error('POST /api/drawings error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
