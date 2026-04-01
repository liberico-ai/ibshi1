import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/lessons — list lesson learned grouped by project
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')
    const category = searchParams.get('category')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId
    if (category) where.category = category

    const lessons = await prisma.lessonLearned.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const stats = await prisma.lessonLearned.groupBy({ by: ['category'], _count: true })

    return successResponse({
      lessons,
      total: lessons.length,
      stats: stats.reduce((acc: Record<string, number>, s) => ({ ...acc, [s.category]: s._count }), {}),
    })
  } catch (err) {
    console.error('GET /api/lessons error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/lessons — create lesson learned
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { projectId, category, description, rootCause, actionTaken, recommendation } = body

    if (!projectId || !category || !description) {
      return errorResponse('Thiếu: projectId, category, description')
    }

    const lesson = await prisma.lessonLearned.create({
      data: {
        projectId,
        category,
        description,
        rootCause: rootCause || null,
        actionTaken: actionTaken || null,
        recommendation: recommendation || null,
        submittedBy: user.userId,
      },
    })

    return successResponse({ lesson }, 'Đã ghi nhận bài học kinh nghiệm')
  } catch (err) {
    console.error('POST /api/lessons error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
