import prisma from './db'

// ── Change Event Logger ──

interface ChangeEventParams {
  projectId: string
  sourceStep: string
  sourceModel: string
  sourceId: string
  eventType: 'REJECT' | 'SYNC' | 'SUBSTITUTE' | 'REWORK'
  targetModel: string
  targetId: string
  dataBefore?: Record<string, unknown>
  dataAfter?: Record<string, unknown>
  reason?: string
  triggeredBy: string
}

export async function logChangeEvent(params: ChangeEventParams): Promise<void> {
  await prisma.changeEvent.create({
    data: {
      projectId: params.projectId,
      sourceStep: params.sourceStep,
      sourceModel: params.sourceModel,
      sourceId: params.sourceId,
      eventType: params.eventType,
      targetModel: params.targetModel,
      targetId: params.targetId,
      dataBefore: params.dataBefore ? JSON.parse(JSON.stringify(params.dataBefore)) : undefined,
      dataAfter: params.dataAfter ? JSON.parse(JSON.stringify(params.dataAfter)) : undefined,
      reason: params.reason,
      triggeredBy: params.triggeredBy,
    },
  })
}

// ══════════════════════════════════════════════════════
//  FORWARD SYNC HOOKS (Phase 2)
// ══════════════════════════════════════════════════════

/** P2.2/P2.3 complete → recalc Budget.MATERIAL.planned from BOM items (idempotent recompute) */
export async function syncBOMtoBudget(projectId: string, triggeredBy: string): Promise<void> {
  const boms = await prisma.billOfMaterial.findMany({
    where: { projectId, status: { in: ['APPROVED', 'RELEASED'] } },
    include: { items: { include: { material: true } } },
  })

  let totalPlanned = 0
  for (const bom of boms) {
    for (const item of bom.items) {
      const unitPrice = item.material.unitPrice ? Number(item.material.unitPrice) : 0
      totalPlanned += Number(item.quantity) * unitPrice
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.budget.findFirst({
      where: { projectId, category: 'MATERIAL', month: null, year: null },
    })
    const oldPlanned = existing ? Number(existing.planned) : 0

    if (existing) {
      await tx.budget.update({ where: { id: existing.id }, data: { planned: totalPlanned } })
    } else {
      await tx.budget.create({ data: { projectId, category: 'MATERIAL', planned: totalPlanned } })
    }
    return { oldPlanned, budgetId: existing?.id || 'new' }
  })

  await logChangeEvent({
    projectId, sourceStep: 'P2.2', sourceModel: 'BillOfMaterial',
    sourceId: boms[0]?.id || 'N/A', eventType: 'SYNC',
    targetModel: 'Budget', targetId: result.budgetId,
    dataBefore: { planned: result.oldPlanned },
    dataAfter: { planned: totalPlanned },
    triggeredBy,
  })
}

/** PO approved → recompute Budget.MATERIAL.committed = SUM(approved PO totalValue) (idempotent) */
export async function syncPOtoBudget(projectId: string, _poId: string, triggeredBy: string): Promise<void> {
  const COMMITTED_STATUSES = ['APPROVED', 'SENT', 'CONFIRMED', 'RECEIVED']
  const pos = await prisma.purchaseOrder.findMany({
    where: { projectId, status: { in: COMMITTED_STATUSES } },
    select: { totalValue: true },
  })

  const totalCommitted = pos.reduce((sum, po) => sum + (po.totalValue ? Number(po.totalValue) : 0), 0)

  const result = await prisma.$transaction(async (tx) => {
    const budget = await tx.budget.findFirst({
      where: { projectId, category: 'MATERIAL', month: null, year: null },
    })
    if (!budget) return null
    const oldCommitted = Number(budget.committed)
    await tx.budget.update({ where: { id: budget.id }, data: { committed: totalCommitted } })
    return { oldCommitted, budgetId: budget.id }
  })

  if (result) {
    await logChangeEvent({
      projectId, sourceStep: 'P3.3', sourceModel: 'PurchaseOrder',
      sourceId: _poId, eventType: 'SYNC',
      targetModel: 'Budget', targetId: result.budgetId,
      dataBefore: { committed: result.oldCommitted },
      dataAfter: { committed: totalCommitted },
      triggeredBy,
    })
  }
}


/** Recalculate budget actual from all non-reversed IN movements (po_receipt + warehouse_receipt) */
export async function recalcBudgetActual(projectId: string, _triggeredBy: string): Promise<void> {
  const movements = await prisma.stockMovement.findMany({
    where: {
      projectId,
      type: 'IN',
      reason: { in: ['po_receipt', 'warehouse_receipt'] },
      referenceNo: { not: { startsWith: 'REV-' } },
    },
    include: { material: true },
  })

  let totalActual = 0
  for (const mv of movements) {
    const unitPrice = mv.material.unitPrice ? Number(mv.material.unitPrice) : 0
    totalActual += Number(mv.quantity) * unitPrice
  }

  const budget = await prisma.budget.findFirst({
    where: { projectId, category: 'MATERIAL', month: null, year: null },
  })

  if (budget) {
    await prisma.budget.update({
      where: { id: budget.id },
      data: { actual: totalActual },
    })
  }
}

const BUDGET_RELEVANT_STEPS = new Set(['P3.1', 'P3.3', 'P3.4', 'P3.5', 'P3.6', 'P4.3', 'P4.4', 'P4.5'])

/** Dispatch reverse hooks — only recalc budget for Phase 3-4 rejections */
export async function runReverseHooks(
  projectId: string,
  stepCode: string,
  triggeredBy: string,
  _reason: string,
): Promise<void> {
  try {
    if (BUDGET_RELEVANT_STEPS.has(stepCode)) {
      await recalcBudgetActual(projectId, triggeredBy)
    }
  } catch (err) {
    console.error(`Reverse hook error for ${stepCode}:`, err)
  }
}
