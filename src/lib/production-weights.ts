import prisma from '@/lib/db'

export const STAGE_WEIGHTS: Record<string, number> = {
  cutting:    0.10,
  assembly:   0.20,
  welding:    0.35,
  painting:   0.20,
  inspection: 0.15,
}

export const STAGES_ORDERED = ['cutting', 'assembly', 'welding', 'painting', 'inspection'] as const

export async function rollUpWorkOrder(workOrderId: string) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, plannedWeight: true, status: true },
  })
  if (!wo) return

  const plannedKg = Number(wo.plannedWeight) || 0
  if (plannedKg <= 0) return

  const jobCards = await prisma.jobCard.findMany({
    where: { workOrderId, status: 'COMPLETED' },
    select: { workType: true, actualQty: true },
  })

  const completedStages = new Set(jobCards.map(jc => jc.workType))
  const weightedPct = STAGES_ORDERED.reduce((sum, stage) => {
    if (completedStages.has(stage)) return sum + (STAGE_WEIGHTS[stage] || 0)
    return sum
  }, 0)

  const completedQty = Math.min(Math.round(plannedKg * weightedPct * 100) / 100, plannedKg)

  const hasQcPass = completedStages.has('inspection')
  const earnedQty = hasQcPass ? plannedKg : 0

  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: { completedQty, earnedQty },
  })

  return { completedQty, earnedQty, weightedPct }
}
