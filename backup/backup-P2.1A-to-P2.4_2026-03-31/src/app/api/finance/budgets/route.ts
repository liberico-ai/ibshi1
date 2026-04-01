import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/finance/budgets — project budgets with variance analysis
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const projectId = searchParams.get('projectId')

    const where: Record<string, unknown> = {}
    if (projectId) where.projectId = projectId

    const budgets = await prisma.budget.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true, contractValue: true } },
      },
      orderBy: [{ projectId: 'asc' }, { category: 'asc' }],
    })

    // Group by project for summary
    const byProject: Record<string, { projectCode: string; projectName: string; contractValue: number; categories: typeof budgets }> = {}
    for (const b of budgets) {
      const pid = b.projectId
      if (!byProject[pid]) {
        byProject[pid] = {
          projectCode: b.project.projectCode,
          projectName: b.project.projectName,
          contractValue: Number(b.project.contractValue || 0),
          categories: [],
        }
      }
      byProject[pid].categories.push(b)
    }

    const projects = Object.entries(byProject).map(([id, data]) => {
      const totalPlanned = data.categories.reduce((s, c) => s + Number(c.planned), 0)
      const totalActual = data.categories.reduce((s, c) => s + Number(c.actual), 0)
      const totalCommitted = data.categories.reduce((s, c) => s + Number(c.committed), 0)
      return {
        projectId: id,
        ...data,
        totalPlanned,
        totalActual,
        totalCommitted,
        variance: totalPlanned - totalActual,
        variancePct: totalPlanned > 0 ? Math.round((totalPlanned - totalActual) / totalPlanned * 100) : 0,
      }
    })

    const totals = {
      planned: projects.reduce((s, p) => s + p.totalPlanned, 0),
      actual: projects.reduce((s, p) => s + p.totalActual, 0),
      committed: projects.reduce((s, p) => s + p.totalCommitted, 0),
    }

    return successResponse({ projects, totals })
  } catch (err) {
    console.error('GET /api/finance/budgets error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/finance/budgets — create/update budget entry
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const body = await req.json()
    const { projectId, category, planned, actual, committed, forecast, month, year, notes } = body

    if (!projectId || !category) {
      return errorResponse('Thiếu thông tin: projectId, category')
    }

    const budget = await prisma.budget.upsert({
      where: {
        projectId_category_month_year: {
          projectId,
          category,
          month: month || null,
          year: year || null,
        },
      },
      create: {
        projectId,
        category,
        planned: Number(planned || 0),
        actual: Number(actual || 0),
        committed: Number(committed || 0),
        forecast: Number(forecast || 0),
        month: month || null,
        year: year || null,
        notes,
      },
      update: {
        planned: Number(planned || 0),
        actual: Number(actual || 0),
        committed: Number(committed || 0),
        forecast: Number(forecast || 0),
        notes,
      },
    })

    return successResponse({ budget }, 'Cập nhật ngân sách thành công')
  } catch (err) {
    console.error('POST /api/finance/budgets error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
