import prisma from './db'
import { applyStockMovement } from './stock-ledger'

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
//  PO Total Recalculation
// ══════════════════════════════════════════════════════

/** Recompute PurchaseOrder.totalValue = Σ(item.quantity × item.unitPrice). Returns new total. */
export async function recalcPOTotal(poId: string): Promise<number> {
  const items = await prisma.purchaseOrderItem.findMany({
    where: { poId },
    select: { quantity: true, unitPrice: true },
  })
  const total = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitPrice), 0)
  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { totalValue: Math.round(total) },
  })
  return total
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
      const unitPrice = item.material?.unitPrice ? Number(item.material.unitPrice) : 0
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


/** Recalculate budget actual from all non-reversed IN movements (po_receipt + warehouse_receipt).
 *  Price priority: PurchaseOrderItem.unitPrice (via poItemId) → Material.unitPrice fallback. */
export async function recalcBudgetActual(projectId: string, _triggeredBy: string): Promise<void> {
  const movements = await prisma.stockMovement.findMany({
    where: {
      projectId,
      type: 'IN',
      reason: { in: ['po_receipt', 'warehouse_receipt'] },
      referenceNo: { not: { startsWith: 'REV-' } },
    },
    select: {
      quantity: true,
      poItemId: true,
      materialId: true,
    },
  })

  const poItemIds = movements.map(m => m.poItemId).filter((id): id is string => !!id)
  const poItemPrices = poItemIds.length > 0
    ? await prisma.purchaseOrderItem.findMany({
        where: { id: { in: poItemIds } },
        select: { id: true, unitPrice: true },
      })
    : []
  const poItemPriceMap = new Map(poItemPrices.map(p => [p.id, Number(p.unitPrice)]))

  const materialIds = movements
    .filter(m => !m.poItemId)
    .map(m => m.materialId)
  const materials = materialIds.length > 0
    ? await prisma.material.findMany({
        where: { id: { in: [...new Set(materialIds)] } },
        select: { id: true, unitPrice: true },
      })
    : []
  const materialPriceMap = new Map(materials.map(m => [m.id, Number(m.unitPrice || 0)]))

  let totalActual = 0
  for (const mv of movements) {
    const unitPrice = mv.poItemId
      ? (poItemPriceMap.get(mv.poItemId) ?? 0)
      : (materialPriceMap.get(mv.materialId) ?? 0)
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
const STOCK_RELEVANT_STEPS = new Set(['P3.4', 'P3.4A', 'P3.4B', 'P4.4', 'P4.5'])

/** Create compensating movements for all unreversed movements of a task.
 *  Idempotent: skips if _stockReversed flag already set on task. */
export async function reverseStockMovements(
  projectId: string,
  stepCode: string,
  taskId: string,
  triggeredBy: string,
): Promise<number> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { resultData: true } })
  const rd = (task?.resultData as Record<string, unknown>) || {}
  if (rd._stockReversed) return 0

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { projectCode: true } })
  const projCode = project?.projectCode || 'UNKNOWN'
  const refPattern = `${projCode}-${stepCode}`

  const originals = await prisma.stockMovement.findMany({
    where: {
      projectId,
      referenceNo: refPattern,
      NOT: { referenceNo: { startsWith: 'REV-' } },
    },
  })

  if (originals.length === 0) return 0

  const existingRevs = await prisma.stockMovement.findMany({
    where: { referenceNo: { startsWith: `REV-${refPattern}` }, projectId },
    select: { notes: true },
  })
  const reversedOrigIds = new Set(
    existingRevs.map(r => (r.notes || '').match(/orig:(\S+)/)?.[1]).filter(Boolean)
  )

  let count = 0
  await prisma.$transaction(async (tx) => {
    for (const mv of originals) {
      if (reversedOrigIds.has(mv.id)) continue
      const reverseType = mv.type === 'IN' ? 'OUT' : 'IN'
      await applyStockMovement(tx, {
        materialId: mv.materialId,
        warehouseId: mv.warehouseId,
        projectId,
        type: reverseType as 'IN' | 'OUT',
        quantity: Number(mv.quantity),
        reason: `reverse_${mv.reason}`,
        referenceNo: `REV-${refPattern}`,
        performedBy: triggeredBy,
        notes: `Đảo ngược reject ${stepCode}, orig:${mv.id}`,
      })
      count++
    }

    await tx.task.update({
      where: { id: taskId },
      data: { resultData: { ...rd, _stockReversed: true } },
    })
  })

  if (count > 0) {
    const negativeStocks = await prisma.materialStock.findMany({
      where: { materialId: { in: originals.map(m => m.materialId) }, quantity: { lt: 0 } },
      include: { material: { select: { materialCode: true } }, warehouse: { select: { code: true } } },
    })
    for (const ns of negativeStocks) {
      console.warn(`[STOCK] Tồn âm sau reject: ${ns.material.materialCode} @ ${ns.warehouse.code}: ${Number(ns.quantity)}`)
    }
  }

  return count
}

/** Dispatch reverse hooks — stock reversal + budget recalc for Phase 3-4 rejections */
export async function runReverseHooks(
  projectId: string,
  stepCode: string,
  triggeredBy: string,
  _reason: string,
  taskId?: string,
): Promise<void> {
  try {
    if (STOCK_RELEVANT_STEPS.has(stepCode) && taskId) {
      const reversed = await reverseStockMovements(projectId, stepCode, taskId, triggeredBy)
      if (reversed > 0) console.log(`[SYNC] Reversed ${reversed} stock movements for ${stepCode} on project ${projectId}`)
    }
    if (BUDGET_RELEVANT_STEPS.has(stepCode)) {
      await recalcBudgetActual(projectId, triggeredBy)
    }
  } catch (err) {
    console.error(`Reverse hook error for ${stepCode}:`, err)
  }
}
