import { Prisma } from '@prisma/client'
import prisma from './db'
import { applyStockMovement } from './stock-ledger'

type Tx = Prisma.TransactionClient

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

/** PO approved → recompute Budget.MATERIAL.committed = SUM(approved PO totalValue) (idempotent)
 *  PO-Gate: committed CHỈ tính PO từ APPROVED trở đi — PENDING/DRAFT/REJECTED/CANCELLED không tính.
 *  Bao gồm cả các trạng thái sau duyệt (PROCESSING_PAYMENT/PAID/PARTIAL_RECEIVED/COMPLETED)
 *  để committed không tụt khi PO đi tiếp trong chuỗi thanh toán/nhận hàng. */
export async function syncPOtoBudget(projectId: string, _poId: string, triggeredBy: string): Promise<void> {
  const COMMITTED_STATUSES = ['APPROVED', 'SENT', 'CONFIRMED', 'PROCESSING_PAYMENT', 'PAID', 'PARTIAL_RECEIVED', 'RECEIVED', 'COMPLETED']
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


// ══════════════════════════════════════════════════════
//  Dự toán duyệt → Budget planned (form ESTIMATE, P1.2/P1.3)
// ══════════════════════════════════════════════════════

export interface EstimateTotals {
  totalMaterial?: number
  totalLabor?: number
  totalService?: number
  totalOverhead?: number
}

/** Taxonomy chuẩn: 4 nhóm DTTC (dự toán tài chính, mã tiếng Việt trong
 *  docs/handoff/import/budget_import.csv) → Budget.category (mã tiếng Anh).
 *  ĐÂY LÀ NGUỒN DUY NHẤT của ánh xạ 4 nhóm — nơi khác import.
 *  Lưu ý: DICH_VU có danh mục riêng SERVICE — KHÔNG gộp vào MATERIAL/OVERHEAD, nếu không dòng dịch vụ bị mất. */
export const DTTC_GROUP_TO_BUDGET_CATEGORY = {
  VAT_TU: 'MATERIAL',
  NHAN_CONG: 'LABOR',
  DICH_VU: 'SERVICE',
  CHI_PHI_CHUNG: 'OVERHEAD',
} as const

export type DttcGroupCode = keyof typeof DTTC_GROUP_TO_BUDGET_CATEGORY

/** Map 1 mã nhóm DTTC → Budget.category. Trả null nếu mã không thuộc 4 nhóm chuẩn. */
export function dttcGroupToBudgetCategory(group: string): string | null {
  return (DTTC_GROUP_TO_BUDGET_CATEGORY as Record<string, string>)[group] ?? null
}

// EstimateTotals key ↔ nhóm DTTC (giữ đủ 4 field — DICH_VU→totalService, không đọc thiếu field nào).
const ESTIMATE_CATEGORY_MAP: ReadonlyArray<readonly [keyof EstimateTotals, string]> = [
  ['totalMaterial', DTTC_GROUP_TO_BUDGET_CATEGORY.VAT_TU],
  ['totalLabor', DTTC_GROUP_TO_BUDGET_CATEGORY.NHAN_CONG],
  ['totalService', DTTC_GROUP_TO_BUDGET_CATEGORY.DICH_VU],
  ['totalOverhead', DTTC_GROUP_TO_BUDGET_CATEGORY.CHI_PHI_CHUNG],
] as const

/** Dự toán (form ESTIMATE) hoàn thành/duyệt → upsert Budget.planned theo từng category.
 *  Idempotent: recompute-set theo (projectId, category, month=null, year=null) — gọi nhiều lần không nhân đôi.
 *  Lưu ý: MATERIAL.planned có thể được syncBOMtoBudget ghi đè sau (BOM Phase 2 chi tiết hơn dự toán Phase 1). */
export async function syncEstimateToBudget(
  projectId: string,
  totals: EstimateTotals,
  triggeredBy: string,
  sourceId: string = 'N/A',
): Promise<void> {
  const entries = ESTIMATE_CATEGORY_MAP
    .map(([key, category]) => ({ category, planned: Number(totals[key]) }))
    .filter(e => Number.isFinite(e.planned) && e.planned > 0)
  if (entries.length === 0) return

  const before: Record<string, number> = {}
  const after: Record<string, number> = {}

  await prisma.$transaction(async (tx) => {
    for (const { category, planned } of entries) {
      const existing = await tx.budget.findFirst({
        where: { projectId, category, month: null, year: null },
      })
      before[category] = existing ? Number(existing.planned) : 0
      after[category] = planned
      if (existing) {
        await tx.budget.update({ where: { id: existing.id }, data: { planned } })
      } else {
        await tx.budget.create({ data: { projectId, category, planned } })
      }
    }
  })

  await logChangeEvent({
    projectId, sourceStep: 'P1.3', sourceModel: 'Task',
    sourceId, eventType: 'SYNC',
    targetModel: 'Budget', targetId: projectId,
    dataBefore: { planned: before },
    dataAfter: { planned: after },
    reason: 'Dự toán duyệt → Budget.planned',
    triggeredBy,
  })
}

// ══════════════════════════════════════════════════════
//  Actual — NGUỒN DUY NHẤT tính chi phí thực tế theo category
// ══════════════════════════════════════════════════════
//  Quy tắc nguồn (chống double-count):
//  - MATERIAL = giá trị StockMovement IN (po_receipt/warehouse_receipt, không REV-),
//    đơn giá ưu tiên PurchaseOrderItem.unitPrice → fallback Material.unitPrice.
//    (GRN là điểm ghi nhận vật tư; thanh toán PO KHÔNG cộng lại.)
//  - LABOR    = Σ MonthlyPieceRateOutput.totalAmount đã nghiệm thu (status=VERIFIED)
//    của các hợp đồng khoán thuộc dự án.
//  - SERVICE  = Σ Invoice.paidAmount của hóa đơn CHI (type != RECEIVABLE) thuộc dự án
//    KHÔNG gắn PO vật tư (poId=null và description không chứa "Đơn đặt hàng:").
//    paidAmount là nguồn duy nhất — cả drawdown execute lẫn payment thường đều ghi vào đây.
//  Mọi điểm phát sinh chi phí (GRN, drawdown execute, payment, duyệt KL khoán) chỉ cần
//  gọi recalcBudgetActual(projectId) — hàm này recompute toàn bộ, idempotent.

/** Đặt Budget.actual cho 1 category (update nếu có, create nếu chưa có và amount > 0). */
async function setBudgetActual(projectId: string, category: string, amount: number): Promise<void> {
  const budget = await prisma.budget.findFirst({
    where: { projectId, category, month: null, year: null },
  })
  if (budget) {
    await prisma.budget.update({ where: { id: budget.id }, data: { actual: amount } })
  } else if (amount > 0) {
    await prisma.budget.create({ data: { projectId, category, actual: amount } })
  }
}

/** MATERIAL actual: giá trị nhập kho từ mua hàng (không tính movement đảo REV-). */
async function calcMaterialActual(projectId: string): Promise<number> {
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

  let total = 0
  for (const mv of movements) {
    const unitPrice = mv.poItemId
      ? (poItemPriceMap.get(mv.poItemId) ?? 0)
      : (materialPriceMap.get(mv.materialId) ?? 0)
    total += Number(mv.quantity) * unitPrice
  }
  return total
}

/** LABOR actual: tổng KL khoán đã nghiệm thu (VERIFIED) của dự án. */
async function calcLaborActual(projectId: string): Promise<number> {
  const outputs = await prisma.monthlyPieceRateOutput.findMany({
    where: { status: 'VERIFIED', contract: { projectId } },
    select: { totalAmount: true },
  })
  return outputs.reduce((s, o) => s + Number(o.totalAmount), 0)
}

/** Regex nhận diện hóa đơn gắn PO vật tư (drawdown flow ghi mã PO vào description). */
const PO_LINKED_DESC_REGEX = /Đơn đặt hàng:/

/** SERVICE actual: tiền đã thực chi (paidAmount) cho hóa đơn CHI không gắn PO vật tư.
 *  Hóa đơn gắn PO bị loại — giá trị vật tư đã tính ở MATERIAL qua GRN (chống double-count). */
async function calcServiceActual(projectId: string): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    where: {
      projectId,
      type: { not: 'RECEIVABLE' },
      paidAmount: { gt: 0 },
    },
    select: { paidAmount: true, poId: true, description: true },
  })
  return invoices
    .filter(inv => !inv.poId && !PO_LINKED_DESC_REGEX.test(inv.description || ''))
    .reduce((s, inv) => s + Number(inv.paidAmount), 0)
}

export interface ProjectActualCosts {
  material: number
  labor: number
  service: number
}

/** Tính chi phí thực tế theo 3 nguồn chuẩn ở trên — dùng chung cho
 *  recalcBudgetActual (Budget.actual) và quyết toán dự án (ProjectSettlement).
 *  KHÔNG copy công thức này ra nơi khác — import hàm này. */
export async function calcProjectActualCosts(projectId: string): Promise<ProjectActualCosts> {
  const material = await calcMaterialActual(projectId)
  const labor = await calcLaborActual(projectId)
  const service = await calcServiceActual(projectId)
  return { material, labor, service }
}

/** Recompute toàn bộ Budget.actual của dự án theo quy tắc nguồn ở trên. Idempotent. */
export async function recalcBudgetActual(projectId: string, _triggeredBy: string): Promise<void> {
  const { material, labor, service } = await calcProjectActualCosts(projectId)

  await setBudgetActual(projectId, 'MATERIAL', material)
  await setBudgetActual(projectId, 'LABOR', labor)
  await setBudgetActual(projectId, 'SERVICE', service)
}

// ══════════════════════════════════════════════════════
//  Giải ngân (LoanDrawdown) → CashflowEntry hướng CHI
// ══════════════════════════════════════════════════════

/** Ghi 1 CashflowEntry OUTFLOW cho hồ sơ giải ngân đã chốt.
 *  Idempotent theo reference = drawdown.id (gọi 2 lần không nhân đôi).
 *  Chạy TRONG transaction của caller (cùng transaction với update status EXECUTED).
 *  @returns true nếu tạo mới, false nếu đã tồn tại. */
export async function recordDrawdownCashflow(
  tx: Tx,
  drawdown: { id: string; drawdownNo: string; amountFundedVnd: Prisma.Decimal | number },
  projectId: string | null,
): Promise<boolean> {
  const existing = await tx.cashflowEntry.findFirst({
    where: { reference: drawdown.id, category: 'LOAN_DRAWDOWN' },
  })
  if (existing) return false

  await tx.cashflowEntry.create({
    data: {
      entryCode: `CF-DD-${drawdown.drawdownNo}`,
      type: 'OUTFLOW',
      category: 'LOAN_DRAWDOWN',
      amount: drawdown.amountFundedVnd,
      description: `Giải ngân hồ sơ ${drawdown.drawdownNo}`,
      entryDate: new Date(),
      reference: drawdown.id,
      projectId,
    },
  })
  return true
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
