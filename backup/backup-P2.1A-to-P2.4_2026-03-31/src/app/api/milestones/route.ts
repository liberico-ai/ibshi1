import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/milestones?projectId= — list milestones for project
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId

    const milestones = await prisma.milestone.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true, contractValue: true } },
      },
      orderBy: [{ projectId: 'asc' }, { sortOrder: 'asc' }],
    })

    // Group by project and calculate billing progress
    const byProject: Record<string, { projectCode: string; projectName: string; contractValue: number; milestones: typeof milestones; billingCompleted: number; billingTotal: number }> = {}
    for (const m of milestones) {
      const pid = m.projectId
      if (!byProject[pid]) {
        byProject[pid] = {
          projectCode: m.project.projectCode,
          projectName: m.project.projectName,
          contractValue: Number(m.project.contractValue || 0),
          milestones: [],
          billingCompleted: 0,
          billingTotal: 0,
        }
      }
      byProject[pid].milestones.push(m)
      byProject[pid].billingTotal += Number(m.billingPercent || 0)
      if (m.status === 'COMPLETED') byProject[pid].billingCompleted += Number(m.billingPercent || 0)
    }

    const projects = Object.entries(byProject).map(([id, data]) => ({
      projectId: id,
      ...data,
      billingProgress: data.billingTotal > 0 ? Math.round(data.billingCompleted / data.billingTotal * 100) : 0,
    }))

    return successResponse({
      milestones,
      projects,
      totalMilestones: milestones.length,
      completedMilestones: milestones.filter(m => m.status === 'COMPLETED').length,
    })
  } catch (err) {
    console.error('GET /api/milestones error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/milestones — create milestone
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { projectId, name, nameEn, description, billingPercent, plannedDate, sortOrder } = body

    if (!projectId || !name) {
      return errorResponse('Thiếu thông tin: projectId, name')
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    const milestone = await prisma.milestone.create({
      data: {
        projectId,
        name,
        nameEn: nameEn || '',
        description,
        billingPercent: Number(billingPercent || 0),
        plannedDate: plannedDate ? new Date(plannedDate) : null,
        sortOrder: sortOrder || 0,
      },
    })

    return successResponse({ milestone }, 'Tạo cột mốc thành công')
  } catch (err) {
    console.error('POST /api/milestones error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/milestones — update milestone status
export async function PATCH(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { id, status, actualDate } = body

    if (!id || !status) return errorResponse('Thiếu id hoặc status')

    const data: Record<string, unknown> = { status }
    if (status === 'COMPLETED' && !actualDate) data.actualDate = new Date()
    else if (actualDate) data.actualDate = new Date(actualDate)

    const milestone = await prisma.milestone.update({ where: { id }, data })

    return successResponse({ milestone }, 'Cập nhật cột mốc thành công')
  } catch (err) {
    console.error('PATCH /api/milestones error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
