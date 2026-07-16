/**
 * Unit tests for src/lib/sync-engine.ts
 *
 * All Prisma calls are mocked via the __mocks__/db.ts auto-mock pattern.
 */

import { vi } from 'vitest'

// ── Mock Prisma ──
import { prismaMock } from '@/lib/__mocks__/db'
import {
  logChangeEvent,
  syncBOMtoBudget,
  syncPOtoBudget,
  syncEstimateToBudget,
  recalcBudgetActual,
  recalcPOTotal,
  recordDrawdownCashflow,
  runReverseHooks,
  dttcGroupToBudgetCategory,
  DTTC_GROUP_TO_BUDGET_CATEGORY,
} from '@/lib/sync-engine'

// ── Helpers ──

const PROJECT_ID = 'proj-1'
const USER = 'user-1'

// ── logChangeEvent ──

describe('logChangeEvent', () => {
  it('creates a ChangeEvent with all provided fields', async () => {
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await logChangeEvent({
      projectId: PROJECT_ID,
      sourceStep: 'P2.2',
      sourceModel: 'BillOfMaterial',
      sourceId: 'bom-1',
      eventType: 'SYNC',
      targetModel: 'Budget',
      targetId: 'budget-1',
      dataBefore: { planned: 0 },
      dataAfter: { planned: 1000 },
      reason: 'test reason',
      triggeredBy: USER,
    })

    expect(prismaMock.changeEvent.create).toHaveBeenCalledOnce()
    const call = prismaMock.changeEvent.create.mock.calls[0][0]
    expect(call.data).toMatchObject({
      projectId: PROJECT_ID,
      sourceStep: 'P2.2',
      sourceModel: 'BillOfMaterial',
      sourceId: 'bom-1',
      eventType: 'SYNC',
      targetModel: 'Budget',
      targetId: 'budget-1',
      triggeredBy: USER,
      reason: 'test reason',
    })
  })

  it('omits dataBefore/dataAfter when not provided', async () => {
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await logChangeEvent({
      projectId: PROJECT_ID,
      sourceStep: 'P2.2',
      sourceModel: 'BillOfMaterial',
      sourceId: 'bom-1',
      eventType: 'SYNC',
      targetModel: 'Budget',
      targetId: 'budget-1',
      triggeredBy: USER,
    })

    const call = prismaMock.changeEvent.create.mock.calls[0][0]
    expect(call.data.dataBefore).toBeUndefined()
    expect(call.data.dataAfter).toBeUndefined()
  })
})

// ── syncBOMtoBudget ──

describe('syncBOMtoBudget', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
  })

  it('calculates totalPlanned from BOM items and updates existing budget', async () => {
    const budget = { id: 'budget-1', planned: 500 }
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      {
        id: 'bom-1',
        items: [
          { quantity: 10, material: { unitPrice: 20 } },
          { quantity: 5, material: { unitPrice: 30 } },
        ],
      },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(budget as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncBOMtoBudget(PROJECT_ID, USER)

    // 10*20 + 5*30 = 350
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { planned: 350 },
    })
  })

  it('creates a new budget when none exists', async () => {
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      {
        id: 'bom-1',
        items: [{ quantity: 2, material: { unitPrice: 100 } }],
      },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncBOMtoBudget(PROJECT_ID, USER)

    expect(prismaMock.budget.create).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, category: 'MATERIAL', planned: 200 },
    })
    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })

  it('treats null unitPrice as zero', async () => {
    prismaMock.billOfMaterial.findMany.mockResolvedValue([
      {
        id: 'bom-1',
        items: [{ quantity: 10, material: { unitPrice: null } }],
      },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncBOMtoBudget(PROJECT_ID, USER)

    expect(prismaMock.budget.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ planned: 0 }) }),
    )
  })
})

// ── syncPOtoBudget (recompute) ──

describe('syncPOtoBudget', () => {
  it('recomputes committed from all approved POs', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { totalValue: 3000 },
      { totalValue: 2000 },
    ] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1', committed: 999 } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { committed: 5000 },
    })
  })

  it('is idempotent — calling twice yields same committed', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { totalValue: 5000 },
    ] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1', committed: 5000 } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)
    prismaMock.changeEvent.create.mockResolvedValue({} as any)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)
    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    const calls = prismaMock.budget.update.mock.calls
    expect(calls.every((c: any) => c[0].data.committed === 5000)).toBe(true)
  })

  it('does nothing when no budget exists', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ totalValue: 1000 }] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })

  it('PO-Gate: committed chỉ tính PO APPROVED trở đi — loại PENDING/DRAFT/REJECTED/CANCELLED', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([] as any)
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await syncPOtoBudget(PROJECT_ID, 'po-1', USER)

    const arg = prismaMock.purchaseOrder.findMany.mock.calls[0][0] as any
    const statuses: string[] = arg?.where?.status?.in || []
    expect(statuses).toContain('APPROVED')
    // Trạng thái sau duyệt vẫn tính committed (không tụt khi PO đi tiếp chuỗi thanh toán/nhận hàng)
    expect(statuses).toEqual(expect.arrayContaining(['PROCESSING_PAYMENT', 'PAID', 'PARTIAL_RECEIVED', 'RECEIVED']))
    // Trước duyệt / bị loại — KHÔNG tính
    for (const blocked of ['PENDING', 'DRAFT', 'REJECTED', 'CANCELLED']) {
      expect(statuses).not.toContain(blocked)
    }
  })
})


// ── recalcPOTotal ──

describe('recalcPOTotal', () => {
  it('sums qty × unitPrice for all PO items and updates totalValue', async () => {
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { quantity: 10, unitPrice: 100 },
      { quantity: 5, unitPrice: 200 },
    ] as any)
    prismaMock.purchaseOrder.update.mockResolvedValue({} as any)

    const total = await recalcPOTotal('po-1')

    expect(total).toBe(2000) // 10*100 + 5*200
    expect(prismaMock.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po-1' },
      data: { totalValue: 2000 },
    })
  })

  it('returns 0 for PO with no items', async () => {
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrder.update.mockResolvedValue({} as any)

    const total = await recalcPOTotal('po-empty')
    expect(total).toBe(0)
  })
})

// ── Taxonomy 4 nhóm DTTC → Budget.category ──

describe('DTTC taxonomy (4 nhóm → Budget.category)', () => {
  it('map đủ 4 nhóm, DICH_VU có danh mục riêng SERVICE', () => {
    expect(dttcGroupToBudgetCategory('VAT_TU')).toBe('MATERIAL')
    expect(dttcGroupToBudgetCategory('NHAN_CONG')).toBe('LABOR')
    expect(dttcGroupToBudgetCategory('DICH_VU')).toBe('SERVICE')
    expect(dttcGroupToBudgetCategory('CHI_PHI_CHUNG')).toBe('OVERHEAD')
  })

  it('DICH_VU KHÔNG bị gộp vào MATERIAL/OVERHEAD (mỗi nhóm ra 1 category duy nhất)', () => {
    const cats = Object.values(DTTC_GROUP_TO_BUDGET_CATEGORY)
    expect(new Set(cats).size).toBe(4) // không trùng → không nhóm nào bị nuốt
    expect(cats).toContain('SERVICE')
  })

  it('trả null cho mã nhóm không hợp lệ', () => {
    expect(dttcGroupToBudgetCategory('UNKNOWN')).toBeNull()
    expect(dttcGroupToBudgetCategory('')).toBeNull()
  })
})

// ── syncEstimateToBudget (dự toán duyệt → planned) ──

describe('syncEstimateToBudget', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock))
    prismaMock.changeEvent.create.mockResolvedValue({} as any)
  })

  it('tạo Budget.planned đúng category từ totals dự toán', async () => {
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)

    await syncEstimateToBudget(
      PROJECT_ID,
      { totalMaterial: 1000, totalLabor: 500, totalService: 200, totalOverhead: 100 },
      USER,
    )

    expect(prismaMock.budget.create).toHaveBeenCalledTimes(4)
    expect(prismaMock.budget.create).toHaveBeenCalledWith({ data: { projectId: PROJECT_ID, category: 'MATERIAL', planned: 1000 } })
    expect(prismaMock.budget.create).toHaveBeenCalledWith({ data: { projectId: PROJECT_ID, category: 'LABOR', planned: 500 } })
    expect(prismaMock.budget.create).toHaveBeenCalledWith({ data: { projectId: PROJECT_ID, category: 'SERVICE', planned: 200 } })
    expect(prismaMock.budget.create).toHaveBeenCalledWith({ data: { projectId: PROJECT_ID, category: 'OVERHEAD', planned: 100 } })
  })

  it('E2E thật: 4 nhóm DTTC (25-VPI-I-095) → 4 dòng Budget riêng, DICH_VU không mất', async () => {
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)

    // Số liệu thật từ docs/handoff/import/budget_import.csv (VAT_TU/NHAN_CONG/DICH_VU/CHI_PHI_CHUNG)
    await syncEstimateToBudget(
      PROJECT_ID,
      { totalMaterial: 109189686612, totalLabor: 43691372573, totalService: 5612774255, totalOverhead: 43312109057 },
      USER,
    )

    expect(prismaMock.budget.create).toHaveBeenCalledTimes(4)
    const cats = prismaMock.budget.create.mock.calls.map((c: any) => c[0].data.category)
    expect(new Set(cats)).toEqual(new Set(['MATERIAL', 'LABOR', 'SERVICE', 'OVERHEAD']))
    // DICH_VU → SERVICE với đúng số tiền (không bị gộp/rơi)
    expect(prismaMock.budget.create).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, category: 'SERVICE', planned: 5612774255 },
    })
  })

  it('idempotent — gọi 2 lần chỉ recompute-set, không nhân đôi', async () => {
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-mat', planned: 999 } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await syncEstimateToBudget(PROJECT_ID, { totalMaterial: 1000 }, USER)
    await syncEstimateToBudget(PROJECT_ID, { totalMaterial: 1000 }, USER)

    expect(prismaMock.budget.create).not.toHaveBeenCalled()
    const calls = prismaMock.budget.update.mock.calls
    expect(calls).toHaveLength(2)
    expect(calls.every((c: any) => c[0].data.planned === 1000)).toBe(true)
  })

  it('bỏ qua category có total = 0 hoặc thiếu', async () => {
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)

    await syncEstimateToBudget(PROJECT_ID, { totalMaterial: 0, totalLabor: 300 }, USER)

    expect(prismaMock.budget.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.budget.create).toHaveBeenCalledWith({ data: { projectId: PROJECT_ID, category: 'LABOR', planned: 300 } })
  })

  it('không làm gì khi totals rỗng', async () => {
    await syncEstimateToBudget(PROJECT_ID, {}, USER)

    expect(prismaMock.budget.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.changeEvent.create).not.toHaveBeenCalled()
  })
})

// ── recordDrawdownCashflow (giải ngân → CashflowEntry OUTFLOW) ──

describe('recordDrawdownCashflow', () => {
  const drawdown = { id: 'dd-1', drawdownNo: 'DD-001', amountFundedVnd: 5000 as any }

  it('tạo CashflowEntry OUTFLOW với amount + projectId + reference = drawdownId', async () => {
    prismaMock.cashflowEntry.findFirst.mockResolvedValue(null)
    prismaMock.cashflowEntry.create.mockResolvedValue({} as any)

    const created = await recordDrawdownCashflow(prismaMock as any, drawdown, PROJECT_ID)

    expect(created).toBe(true)
    expect(prismaMock.cashflowEntry.create).toHaveBeenCalledOnce()
    const data = prismaMock.cashflowEntry.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      entryCode: 'CF-DD-DD-001',
      type: 'OUTFLOW',
      category: 'LOAN_DRAWDOWN',
      amount: 5000,
      reference: 'dd-1',
      projectId: PROJECT_ID,
    })
  })

  it('idempotent — gọi 2 lần chỉ sinh 1 entry (không nhân đôi)', async () => {
    prismaMock.cashflowEntry.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cf-1' } as any)
    prismaMock.cashflowEntry.create.mockResolvedValue({} as any)

    const first = await recordDrawdownCashflow(prismaMock as any, drawdown, PROJECT_ID)
    const second = await recordDrawdownCashflow(prismaMock as any, drawdown, PROJECT_ID)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(prismaMock.cashflowEntry.create).toHaveBeenCalledOnce()
  })
})

// ── recalcBudgetActual ──

describe('recalcBudgetActual', () => {
  beforeEach(() => {
    // Mặc định: không có KL khoán / hóa đơn chi — từng test override khi cần
    prismaMock.monthlyPieceRateOutput.findMany.mockResolvedValue([] as any)
    prismaMock.invoice.findMany.mockResolvedValue([] as any)
  })

  it('uses PO item price when poItemId is set', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 10, poItemId: 'poi-1', materialId: 'mat-1' },
      { quantity: 5, poItemId: 'poi-2', materialId: 'mat-2' },
    ] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', unitPrice: 100 },
      { id: 'poi-2', unitPrice: 200 },
    ] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    // 10*100 + 5*200 = 2000
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 2000 },
    })
  })

  it('falls back to material.unitPrice when no poItemId', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 8, poItemId: null, materialId: 'mat-1' },
    ] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([
      { id: 'mat-1', unitPrice: 50 },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    // 8*50 = 400
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 400 },
    })
  })

  it('does nothing when no budget exists', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)

    await recalcBudgetActual(PROJECT_ID, USER)

    expect(prismaMock.budget.update).not.toHaveBeenCalled()
    expect(prismaMock.budget.create).not.toHaveBeenCalled()
  })

  it('LABOR actual = tổng KL khoán đã nghiệm thu (VERIFIED)', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.monthlyPieceRateOutput.findMany.mockResolvedValue([
      { totalAmount: 400 },
      { totalAmount: 300 },
    ] as any)
    // Budget row riêng theo category
    prismaMock.budget.findFirst.mockImplementation(async (args: any) => (
      { id: `budget-${args.where.category}` } as any
    ))
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    // Query đúng nguồn: chỉ output VERIFIED của dự án
    expect(prismaMock.monthlyPieceRateOutput.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'VERIFIED', contract: { projectId: PROJECT_ID } } }),
    )
    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-LABOR' },
      data: { actual: 700 },
    })
  })

  it('SERVICE actual = payment/drawdown đã chi KHÔNG gắn PO vật tư (chống double-count với GRN)', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.invoice.findMany.mockResolvedValue([
      { paidAmount: 500, poId: null, description: 'Thuê cẩu lắp dựng' },          // dịch vụ → tính
      { paidAmount: 800, poId: 'po-1', description: null },                        // gắn PO vật tư → loại
      { paidAmount: 300, poId: null, description: 'Tạm ứng cho Đơn đặt hàng: PO-2026-001' }, // drawdown gắn PO → loại
    ] as any)
    prismaMock.budget.findFirst.mockImplementation(async (args: any) => (
      { id: `budget-${args.where.category}` } as any
    ))
    prismaMock.budget.update.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-SERVICE' },
      data: { actual: 500 },
    })
    // Không call nào cộng 800/300 vào SERVICE
    const serviceCalls = prismaMock.budget.update.mock.calls.filter((c: any) => c[0].where.id === 'budget-SERVICE')
    expect(serviceCalls).toHaveLength(1)
  })

  it('tạo mới Budget row khi chưa có và actual > 0', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.monthlyPieceRateOutput.findMany.mockResolvedValue([{ totalAmount: 250 }] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
    prismaMock.budget.create.mockResolvedValue({} as any)

    await recalcBudgetActual(PROJECT_ID, USER)

    expect(prismaMock.budget.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.budget.create).toHaveBeenCalledWith({
      data: { projectId: PROJECT_ID, category: 'LABOR', actual: 250 },
    })
  })
})

// ── runReverseHooks dispatcher ──

describe('runReverseHooks', () => {
  beforeEach(() => {
    prismaMock.stockMovement.findMany.mockResolvedValue([] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as any)
    prismaMock.material.findMany.mockResolvedValue([] as any)
    prismaMock.monthlyPieceRateOutput.findMany.mockResolvedValue([] as any)
    prismaMock.invoice.findMany.mockResolvedValue([] as any)
    prismaMock.budget.findFirst.mockResolvedValue(null)
  })

  it('recalcs budget for Phase 3-4 rejection (P4.3)', async () => {
    prismaMock.stockMovement.findMany.mockResolvedValue([
      { quantity: 10, poItemId: 'poi-1', materialId: 'mat-1' },
    ] as any)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { id: 'poi-1', unitPrice: 100 },
    ] as any)
    prismaMock.budget.findFirst.mockResolvedValue({ id: 'budget-1' } as any)
    prismaMock.budget.update.mockResolvedValue({} as any)

    await runReverseHooks(PROJECT_ID, 'P4.3', USER, 'QC reject')

    expect(prismaMock.budget.update).toHaveBeenCalledWith({
      where: { id: 'budget-1' },
      data: { actual: 1000 },
    })
  })

  it('skips recalc for Phase 1 rejection (P1.1B)', async () => {
    await runReverseHooks(PROJECT_ID, 'P1.1B', USER, 'reject reason')

    expect(prismaMock.stockMovement.findMany).not.toHaveBeenCalled()
    expect(prismaMock.budget.update).not.toHaveBeenCalled()
  })

  it('skips recalc for Phase 2 rejection (P2.5)', async () => {
    await runReverseHooks(PROJECT_ID, 'P2.5', USER, 'reject reason')

    expect(prismaMock.stockMovement.findMany).not.toHaveBeenCalled()
  })

  it('catches errors and does not throw', async () => {
    prismaMock.stockMovement.findMany.mockRejectedValue(new Error('DB down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runReverseHooks(PROJECT_ID, 'P3.6', USER, 'fail')).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })
})
