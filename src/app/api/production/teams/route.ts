import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { PRODUCTION_WORKSHOPS } from '@/lib/org-map'

// GET /api/production/teams — Workshop load cards (WO count + tons per XƯỞNG).
// Cơ cấu 5/2026: sản xuất là 5 XƯỞNG (XPC/XCT1/XCT2/XH/XHT) thay 12 tổ TO-* cũ.
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined

  const teams = await prisma.department.findMany({
    where: { code: { in: PRODUCTION_WORKSHOPS.map((w) => w.code) } },
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
          plannedWeight: true, completedQty: true, earnedQty: true,
        },
      })

      const total = wos.length
      const active = wos.filter(w => !['COMPLETED', 'CANCELLED'].includes(w.status)).length
      const plannedKg = wos.reduce((s, w) => s + (Number(w.plannedWeight) || 0), 0)
      const completedKg = wos.reduce((s, w) => s + (Number(w.completedQty) || 0), 0)
      const earnedKg = wos.reduce((s, w) => s + (Number(w.earnedQty) || 0), 0)

      const plannedTons = plannedKg / 1000
      const completedTons = completedKg / 1000
      const earnedTons = earnedKg / 1000

      return {
        id: team.id,
        code: team.code,
        name: team.name,
        totalWO: total,
        activeWO: active,
        plannedTons: Math.round(plannedTons * 100) / 100,
        completedTons: Math.round(completedTons * 100) / 100,
        earnedTons: Math.round(earnedTons * 100) / 100,
        progressPct: plannedTons > 0 ? Math.round((completedTons / plannedTons) * 100) : 0,
        earnedPct: plannedTons > 0 ? Math.round((earnedTons / plannedTons) * 100) : 0,
      }
    })
  )

  return successResponse({ teams: teamLoads })
}
