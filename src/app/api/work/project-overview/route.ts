import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { getProjectOverview } from '@/lib/work-analytics'

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

    const results = await Promise.all(
      projects.map((p) => getProjectOverview(p.id))
    )

    const summaries = results.filter(Boolean)

    const totalContractValue = summaries.reduce(
      (s, r) => s + (r!.project.contractValue || 0), 0
    )
    const totalTasks = summaries.reduce((s, r) => s + r!.totalTasks, 0)
    const totalCompleted = summaries.reduce((s, r) => s + r!.completedTasks, 0)
    const totalOverdue = summaries.reduce(
      (s, r) => s + r!.activeTasks.filter((t) => t.overdue).length, 0
    )
    const totalActive = summaries.reduce(
      (s, r) => s + r!.activeTasks.length, 0
    )

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
      projects: summaries.map((r) => ({
        id: r!.project.id,
        projectCode: r!.project.projectCode,
        projectName: r!.project.projectName,
        clientName: r!.project.clientName,
        status: r!.project.status,
        contractValue: r!.project.contractValue,
        progress: r!.progress,
        totalTasks: r!.totalTasks,
        completedTasks: r!.completedTasks,
        activeTasks: r!.activeTasks.length,
        overdueTasks: r!.activeTasks.filter((t) => t.overdue).length,
        materialDemand: r!.material.demand,
        materialRemaining: r!.material.remaining,
      })),
    })
  } catch (err) {
    console.error('GET /api/work/project-overview error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
