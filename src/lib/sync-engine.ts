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

/** P2.2/P2.3 complete → recalc Budget.MATERIAL.planned from BOM items */
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

  const existing = await prisma.budget.findFirst({
    where: { projectId, category: 'MATERIAL', month: null, year: null },
  })

  const oldPlanned = existing ? Number(existing.planned) : 0

  if (existing) {
    await prisma.budget.update({
      where: { id: existing.id },
      data: { planned: totalPlanned },
    })
  } else {
    await prisma.budget.create({
      data: { projectId, category: 'MATERIAL', planned: totalPlanned },
    })
  }

  await logChangeEvent({
    projectId, sourceStep: 'P2.2', sourceModel: 'BillOfMaterial',
    sourceId: boms[0]?.id || 'N/A', eventType: 'SYNC',
    targetModel: 'Budget', targetId: existing?.id || 'new',
    dataBefore: { planned: oldPlanned },
    dataAfter: { planned: totalPlanned },
    triggeredBy,
  })
}

/** P3.3 PO approved → Budget.MATERIAL.committed += PO total */
export async function syncPOtoBudget(projectId: string, poId: string, triggeredBy: string): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } })
  if (!po || !po.totalValue) return

  const amount = Number(po.totalValue)
  const budget = await prisma.budget.findFirst({
    where: { projectId, category: 'MATERIAL', month: null, year: null },
  })

  if (budget) {
    const oldCommitted = Number(budget.committed)
    await prisma.budget.update({
      where: { id: budget.id },
      data: { committed: { increment: amount } },
    })
    await logChangeEvent({
      projectId, sourceStep: 'P3.3', sourceModel: 'PurchaseOrder',
      sourceId: poId, eventType: 'SYNC',
      targetModel: 'Budget', targetId: budget.id,
      dataBefore: { committed: oldCommitted },
      dataAfter: { committed: oldCommitted + amount },
      triggeredBy,
    })
  }
}

/** P3.4A/B GRN → Budget.MATERIAL.actual += GRN amount */
export async function syncGRNtoBudget(projectId: string, grnAmount: number, triggeredBy: string): Promise<void> {
  const budget = await prisma.budget.findFirst({
    where: { projectId, category: 'MATERIAL', month: null, year: null },
  })

  if (budget) {
    const oldActual = Number(budget.actual)
    await prisma.budget.update({
      where: { id: budget.id },
      data: { actual: { increment: grnAmount } },
    })
    await logChangeEvent({
      projectId, sourceStep: 'P3.4A', sourceModel: 'StockMovement',
      sourceId: 'grn', eventType: 'SYNC',
      targetModel: 'Budget', targetId: budget.id,
      dataBefore: { actual: oldActual },
      dataAfter: { actual: oldActual + grnAmount },
      triggeredBy,
    })
  }
}

/** ECO approved → update BOM items → recalc Budget → flag affected POs */
export async function syncECOcascade(ecoId: string, triggeredBy: string): Promise<void> {
  const eco = await prisma.engineeringChangeOrder.findUnique({ where: { id: ecoId } })
  if (!eco || eco.status !== 'APPROVED') return

  // Recalculate budget from BOM after ECO changes
  await syncBOMtoBudget(eco.projectId, triggeredBy)

  await logChangeEvent({
    projectId: eco.projectId, sourceStep: 'P2.3', sourceModel: 'EngineeringChangeOrder',
    sourceId: ecoId, eventType: 'SYNC',
    targetModel: 'Budget', targetId: 'cascade',
    dataBefore: { ecoStatus: 'SUBMITTED' },
    dataAfter: { ecoStatus: 'APPROVED', budgetRecalculated: true },
    triggeredBy,
  })
}

// ══════════════════════════════════════════════════════
//  REVERSE HOOKS (Phase 3)
// ══════════════════════════════════════════════════════

/** Reverse stock movement — undo IN or OUT */
export async function reverseStockMovement(projectId: string, stepCode: string, triggeredBy: string): Promise<void> {
  // Find the last stock movement created by this step
  const lastMovement = await prisma.stockMovement.findFirst({
    where: { projectId, referenceNo: { contains: stepCode } },
    orderBy: { createdAt: 'desc' },
  })
  if (!lastMovement) return

  const reverseType = lastMovement.type === 'IN' ? 'OUT' : 'IN'
  const reverseQty = Number(lastMovement.quantity)

  await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        materialId: lastMovement.materialId,
        projectId,
        type: reverseType,
        quantity: reverseQty,
        reason: 'qc_reject',
        referenceNo: `REV-${lastMovement.referenceNo}`,
        performedBy: triggeredBy,
        notes: `Reverse: reject ${stepCode}`,
      },
    }),
    prisma.material.update({
      where: { id: lastMovement.materialId },
      data: {
        currentStock: reverseType === 'IN'
          ? { increment: reverseQty }
          : { decrement: reverseQty },
      },
    }),
  ])

  await logChangeEvent({
    projectId, sourceStep: stepCode, sourceModel: 'StockMovement',
    sourceId: lastMovement.id, eventType: 'REJECT',
    targetModel: 'StockMovement', targetId: 'reversed',
    dataBefore: { type: lastMovement.type, quantity: reverseQty },
    dataAfter: { type: reverseType, quantity: reverseQty },
    reason: `Reversed due to reject at ${stepCode}`,
    triggeredBy,
  })
}

/** Reverse material issue — mark voided + return to stock */
export async function reverseMaterialIssue(projectId: string, triggeredBy: string): Promise<void> {
  const wo = await prisma.workOrder.findFirst({
    where: { projectId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
  })
  if (!wo) return

  const lastIssue = await prisma.materialIssue.findFirst({
    where: { workOrderId: wo.id },
    orderBy: { issuedAt: 'desc' },
  })
  if (!lastIssue) return

  const qty = Number(lastIssue.quantity)

  await prisma.$transaction([
    prisma.stockMovement.create({
      data: {
        materialId: lastIssue.materialId,
        projectId,
        type: 'IN',
        quantity: qty,
        reason: 'return',
        referenceNo: `RET-P4.2-${Date.now()}`,
        performedBy: triggeredBy,
        notes: `Return: material issue voided`,
      },
    }),
    prisma.material.update({
      where: { id: lastIssue.materialId },
      data: { currentStock: { increment: qty } },
    }),
  ])

  await logChangeEvent({
    projectId, sourceStep: 'P4.2', sourceModel: 'MaterialIssue',
    sourceId: lastIssue.id, eventType: 'REJECT',
    targetModel: 'Material', targetId: lastIssue.materialId,
    dataBefore: { issued: qty },
    dataAfter: { returned: qty },
    reason: 'Material issue reversed',
    triggeredBy,
  })
}

/** Reverse delivery — mark as RETURNED */
export async function reverseDelivery(projectId: string, triggeredBy: string): Promise<void> {
  const delivery = await prisma.deliveryRecord.findFirst({
    where: { projectId, status: { in: ['SHIPPED', 'DELIVERED'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!delivery) return

  const oldStatus = delivery.status
  await prisma.deliveryRecord.update({
    where: { id: delivery.id },
    data: { status: 'RETURNED', notes: `RETURNED: SAT rejected` },
  })

  await logChangeEvent({
    projectId, sourceStep: 'P5.3', sourceModel: 'DeliveryRecord',
    sourceId: delivery.id, eventType: 'REJECT',
    targetModel: 'DeliveryRecord', targetId: delivery.id,
    dataBefore: { status: oldStatus },
    dataAfter: { status: 'RETURNED' },
    reason: 'SAT rejected — delivery returned',
    triggeredBy,
  })
}

/** Reverse WO status → REWORK */
export async function reverseWOstatus(projectId: string, triggeredBy: string): Promise<void> {
  const wo = await prisma.workOrder.findFirst({
    where: { projectId, status: { in: ['IN_PROGRESS', 'COMPLETED', 'QC_HOLD'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!wo) return

  const oldStatus = wo.status
  await prisma.workOrder.update({
    where: { id: wo.id },
    data: { status: 'REWORK' },
  })

  await logChangeEvent({
    projectId, sourceStep: 'P4.6', sourceModel: 'WorkOrder',
    sourceId: wo.id, eventType: 'REWORK',
    targetModel: 'WorkOrder', targetId: wo.id,
    dataBefore: { status: oldStatus },
    dataAfter: { status: 'REWORK' },
    reason: 'QC/Test reject → rework required',
    triggeredBy,
  })
}

/** Recalculate budget actual from all non-reversed transactions */
export async function recalcBudgetActual(projectId: string, triggeredBy: string): Promise<void> {
  // Sum all stock movements with type IN that are po_receipt (not reversed)
  const movements = await prisma.stockMovement.findMany({
    where: {
      projectId,
      type: 'IN',
      reason: 'po_receipt',
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

/** Dispatch reverse hooks based on step code */
export async function runReverseHooks(
  projectId: string,
  stepCode: string,
  triggeredBy: string,
  _reason: string,
): Promise<void> {
  try {
    // Material receipt rejected → undo stock IN
    if (['P3.4A', 'P3.4B'].includes(stepCode)) {
      await reverseStockMovement(projectId, stepCode, triggeredBy)
    }
    // Material issue rejected → return material
    if (stepCode === 'P4.2') {
      await reverseMaterialIssue(projectId, triggeredBy)
    }
    // QC/Test reject → WO → REWORK
    if (['P4.6', 'P4.7', 'P4.8'].includes(stepCode)) {
      await reverseWOstatus(projectId, triggeredBy)
    }
    // SAT rejected → delivery RETURNED
    if (stepCode === 'P5.3') {
      await reverseDelivery(projectId, triggeredBy)
    }
    // Always recalculate budget after any reject
    await recalcBudgetActual(projectId, triggeredBy)
  } catch (err) {
    console.error(`Reverse hook error for ${stepCode}:`, err)
  }
}
