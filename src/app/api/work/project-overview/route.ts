import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getProjectOverview, getGeneralTasksOverview } from '@/lib/work-analytics'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const projects = await prisma.project.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    })

    const [results, general] = await Promise.all([
      Promise.all(projects.map((p) => getProjectOverview(p.id))),
      getGeneralTasksOverview(),
    ])

    const summaries = results.filter(Boolean)

    const toCard = (r: NonNullable<typeof summaries[number]>) => ({
      id: r.project.id,
      projectCode: r.project.projectCode,
      projectName: r.project.projectName,
      clientName: r.project.clientName,
      status: r.project.status,
      contractValue: r.project.contractValue,
      progress: r.progress,
      totalTasks: r.totalTasks,
      completedTasks: r.completedTasks,
      activeTasks: r.activeTasks.length,
      overdueTasks: r.activeTasks.filter((t) => t.overdue).length,
      materialDemand: r.material.demand,
      materialRemaining: r.material.remaining,
    })

    const projectCards = summaries.map((r) => toCard(r!))
    if (general) projectCards.push(toCard(general))

    const allSources = [...summaries.map(r => r!), ...(general ? [general] : [])]
    const totalContractValue = summaries.reduce((s, r) => s + (r!.project.contractValue || 0), 0)
    const totalTasks = allSources.reduce((s, r) => s + r.totalTasks, 0)
    const totalCompleted = allSources.reduce((s, r) => s + r.completedTasks, 0)
    const totalOverdue = allSources.reduce((s, r) => s + r.activeTasks.filter((t) => t.overdue).length, 0)
    const totalActive = allSources.reduce((s, r) => s + r.activeTasks.length, 0)

    return successResponse({
      aggregate: {
        projectCount: summaries.length,
        totalContractValue,
        totalTasks,
        totalCompleted,
        totalActive,
        totalOverdue,
        overallProgress: totalTasks ? Math.round((totalCompleted / totalTasks) * 100) : 0,
      },
      projects: projectCards,
    })
  } catch (err) {
    console.error('GET /api/work/project-overview error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
