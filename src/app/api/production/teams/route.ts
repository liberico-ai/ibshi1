import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/production/teams — Team load cards (WO count + tons per TO-* department)
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined

  const sxDept = await prisma.department.findFirst({
    where: { code: 'SX' },
    select: { id: true },
  })

  const teams = await prisma.department.findMany({
    where: { parentId: sxDept?.id ?? 'NONE' },
    orderBy: { code: 'asc' },
  })

  const woWhere: Record<string, unknown> = {}
  if (projectId) woWhere.projectId = projectId

  const teamLoads = await Promise.all(
    teams.map(async (team) => {
      const wos = await prisma.workOrder.findMany({
        where: { ...woWhere, departmentId: team.id },
        select: {
          id: true, status: true,
          plannedWeight: true, completedQty: true,
        },
      })

      const total = wos.length
      const active = wos.filter(w => !['COMPLETED', 'CANCELLED'].includes(w.status)).length
      const plannedTons = wos.reduce((s, w) => s + (w.plannedWeight ? Number(w.plannedWeight) / 1000 : 0), 0)
      const completedTons = wos.reduce((s, w) => s + (w.completedQty ? Number(w.completedQty) / 1000 : 0), 0)
      const pct = plannedTons > 0 ? Math.round((completedTons / plannedTons) * 100) : 0

      return {
        id: team.id,
        code: team.code,
        name: team.name,
        totalWO: total,
        activeWO: active,
        plannedTons: Math.round(plannedTons * 100) / 100,
        completedTons: Math.round(completedTons * 100) / 100,
        progressPct: pct,
      }
    })
  )

  return successResponse({ teams: teamLoads })
}
