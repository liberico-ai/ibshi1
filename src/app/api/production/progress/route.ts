import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'
import { STAGE_WEIGHTS, STAGES_ORDERED } from '@/lib/production-weights'

// GET /api/production/progress — Fabrication progress by tons + piece-marks + 5-stage bar
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const departmentId = url.searchParams.get('departmentId') || undefined

  const woWhere: Record<string, unknown> = {}
  if (projectId) woWhere.projectId = projectId
  if (departmentId) woWhere.departmentId = departmentId

  const workOrders = await prisma.workOrder.findMany({
    where: woWhere,
    select: {
      id: true, woCode: true, pieceMark: true, status: true,
      plannedWeight: true, completedQty: true, earnedQty: true, teamCode: true,
      departmentId: true,
      project: { select: { projectCode: true } },
    },
  })

  const totalPieceMarks = workOrders.filter(w => w.pieceMark).length
  const completedPieceMarks = workOrders.filter(w => w.pieceMark && w.status === 'COMPLETED').length
  const earnedPieceMarks = workOrders.filter(w => w.pieceMark && (Number(w.earnedQty) || 0) > 0).length

  const totalKg = workOrders.reduce((s, w) => s + (Number(w.plannedWeight) || 0), 0)
  const completedKg = workOrders.reduce((s, w) => s + (Number(w.completedQty) || 0), 0)
  const earnedKg = workOrders.reduce((s, w) => s + (Number(w.earnedQty) || 0), 0)

  const totalTons = totalKg / 1000
  const completedTons = completedKg / 1000
  const earnedTons = earnedKg / 1000

  const woIds = workOrders.map(w => w.id)

  const jobCards = await prisma.jobCard.findMany({
    where: { workOrderId: { in: woIds }, status: { not: 'CANCELLED' } },
    select: { workType: true, actualQty: true, status: true, workDate: true },
  })

  const stageProgress = STAGES_ORDERED.map(stage => {
    const cards = jobCards.filter(jc => jc.workType === stage)
    const completed = cards.filter(jc => jc.status === 'COMPLETED')
    const totalQty = cards.reduce((s, jc) => s + (Number(jc.actualQty) || 0), 0)
    return {
      stage,
      weight: STAGE_WEIGHTS[stage] || 0,
      totalCards: cards.length,
      completedCards: completed.length,
      totalQty: Math.round(totalQty * 100) / 100,
      pct: cards.length > 0 ? Math.round((completed.length / cards.length) * 100) : 0,
    }
  })

  const dailyOutput = jobCards
    .filter(jc => jc.status === 'COMPLETED' && jc.actualQty)
    .reduce((s, jc) => s + Number(jc.actualQty), 0)

  return successResponse({
    summary: {
      totalTons: Math.round(totalTons * 100) / 100,
      completedTons: Math.round(completedTons * 100) / 100,
      earnedTons: Math.round(earnedTons * 100) / 100,
      tonsPct: totalTons > 0 ? Math.round((completedTons / totalTons) * 100) : 0,
      earnedPct: totalTons > 0 ? Math.round((earnedTons / totalTons) * 100) : 0,
      totalPieceMarks,
      completedPieceMarks,
      earnedPieceMarks,
      pieceMarkPct: totalPieceMarks > 0 ? Math.round((completedPieceMarks / totalPieceMarks) * 100) : 0,
    },
    stages: stageProgress,
    dailyOutputKg: Math.round(dailyOutput * 100) / 100,
    workOrderCount: workOrders.length,
  })
}
