import { describe, it, expect, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { STAGE_WEIGHTS, STAGES_ORDERED, rollUpWorkOrder } from '../production-weights'

describe('STAGE_WEIGHTS', () => {
  it('sums to 1.0', () => {
    const total = STAGES_ORDERED.reduce((s, stage) => s + STAGE_WEIGHTS[stage], 0)
    expect(total).toBeCloseTo(1.0)
  })

  it('has 5 stages in order', () => {
    expect(STAGES_ORDERED).toEqual(['cutting', 'assembly', 'welding', 'painting', 'inspection'])
  })

  it('cutting=10%, assembly=20%, welding=35%, painting=20%, inspection=15%', () => {
    expect(STAGE_WEIGHTS.cutting).toBe(0.10)
    expect(STAGE_WEIGHTS.assembly).toBe(0.20)
    expect(STAGE_WEIGHTS.welding).toBe(0.35)
    expect(STAGE_WEIGHTS.painting).toBe(0.20)
    expect(STAGE_WEIGHTS.inspection).toBe(0.15)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Lệnh CÓ công đoạn: mỗi công đoạn chạy qua TRỌN khối lượng của lệnh (Pha cắt 1000 kg,
// Hàn 1000 kg — hai lượt việc trên cùng khối thép). Nên tiến độ lệnh = công đoạn CHẬM NHẤT,
// tuyệt đối không cộng các công đoạn lại: cộng vào sẽ ra 200% khối lượng thật.
// ─────────────────────────────────────────────────────────────────────────────
describe('rollUpWorkOrder — lệnh chia công đoạn', () => {
  const wo = (planned: number) =>
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: planned as never, status: 'IN_PROGRESS' } as never)
  const congDoan = (...qty: number[]) =>
    prismaMock.workOrderStage.findMany.mockResolvedValue(
      qty.map((q, i) => ({ id: 'st' + i, qty: q })) as never)
  const phieu = (rows: { stageId: string | null; actualQty: number }[]) =>
    prismaMock.jobCard.findMany.mockResolvedValue(
      rows.map(r => ({ workType: 'production', status: 'IN_PROGRESS', ...r })) as never)

  beforeEach(() => {
    prismaMock.workOrder.findUnique.mockReset()
    prismaMock.jobCard.findMany.mockReset()
    prismaMock.workOrder.update.mockReset()
    prismaMock.workOrderStage.findMany.mockReset()
    prismaMock.workOrder.update.mockResolvedValue({} as never)
  })

  it('báo đủ MỘT công đoạn, công đoạn kia chưa làm → lệnh vẫn 0', async () => {
    wo(1000); congDoan(1000, 1000)
    phieu([{ stageId: 'st0', actualQty: 1000 }])
    const r = await rollUpWorkOrder('wo1')
    expect(r?.completedQty).toBe(0)
    expect(r?.earnedQty).toBe(0)
  })

  it('báo đủ CẢ HAI công đoạn → lệnh đủ 1000, KHÔNG phải 2000', async () => {
    wo(1000); congDoan(1000, 1000)
    phieu([{ stageId: 'st0', actualQty: 1000 }, { stageId: 'st1', actualQty: 1000 }])
    const r = await rollUpWorkOrder('wo1')
    expect(r?.completedQty).toBe(1000)
    expect(r?.earnedQty).toBe(1000)
  })

  it('tiến độ chạy theo công đoạn chậm nhất (100% và 40% → 40%)', async () => {
    wo(1000); congDoan(1000, 1000)
    phieu([{ stageId: 'st0', actualQty: 1000 }, { stageId: 'st1', actualQty: 400 }])
    const r = await rollUpWorkOrder('wo1')
    expect(r?.completedQty).toBe(400)
    expect(r?.earnedQty).toBe(0)
  })

  it('mọi công đoạn ≥90% → lệnh coi như xong (biên ±10%)', async () => {
    wo(1000); congDoan(1000, 1000)
    phieu([{ stageId: 'st0', actualQty: 1000 }, { stageId: 'st1', actualQty: 900 }])
    const r = await rollUpWorkOrder('wo1')
    expect(r?.earnedQty).toBe(1000)
  })

  it('phiếu cũ không gắn công đoạn được tính cho MỌI công đoạn (không tụt về 0)', async () => {
    wo(1000); congDoan(1000, 1000)
    phieu([{ stageId: null, actualQty: 1000 }])
    const r = await rollUpWorkOrder('wo1')
    expect(r?.completedQty).toBe(1000)
  })

  it('không vượt quá khối lượng kế hoạch dù báo dư', async () => {
    wo(1000); congDoan(1000, 1000)
    phieu([{ stageId: 'st0', actualQty: 1500 }, { stageId: 'st1', actualQty: 1400 }])
    const r = await rollUpWorkOrder('wo1')
    expect(r?.completedQty).toBe(1000)
  })
})

describe('rollUpWorkOrder', () => {
  beforeEach(() => {
    prismaMock.workOrder.findUnique.mockReset()
    prismaMock.jobCard.findMany.mockReset()
    prismaMock.workOrder.update.mockReset()
    // Mặc định: lệnh KHÔNG khai công đoạn → chạy nhánh cũ (trọng số / cộng dồn kg).
    prismaMock.workOrderStage.findMany.mockReset()
    prismaMock.workOrderStage.findMany.mockResolvedValue([] as never)
  })

  it('returns undefined if WO not found', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue(null)
    const result = await rollUpWorkOrder('missing')
    expect(result).toBeUndefined()
  })

  it('returns undefined if plannedWeight is 0', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 0 as any, status: 'IN_PROGRESS' } as any)
    const result = await rollUpWorkOrder('wo1')
    expect(result).toBeUndefined()
  })

  it('calculates completedQty from weighted stages (cutting only = 10%)', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 1000 as any, status: 'IN_PROGRESS' } as any)
    prismaMock.jobCard.findMany.mockResolvedValue([
      { workType: 'cutting', actualQty: 1000, status: 'COMPLETED' },
    ] as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)

    const result = await rollUpWorkOrder('wo1')

    expect(result?.completedQty).toBe(100)
    expect(result?.earnedQty).toBe(0)
    expect(result?.weightedPct).toBeCloseTo(0.10)
  })

  it('calculates completedQty from cutting+welding = 45%', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 2000 as any, status: 'IN_PROGRESS' } as any)
    prismaMock.jobCard.findMany.mockResolvedValue([
      { workType: 'cutting', actualQty: 2000, status: 'COMPLETED' },
      { workType: 'welding', actualQty: 2000, status: 'COMPLETED' },
    ] as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)

    const result = await rollUpWorkOrder('wo1')

    expect(result?.completedQty).toBe(900)
    expect(result?.earnedQty).toBe(0)
  })

  it('all 5 stages = 100%, earnedQty = plannedWeight', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 5000 as any, status: 'QC_PASSED' } as any)
    prismaMock.jobCard.findMany.mockResolvedValue([
      { workType: 'cutting', actualQty: 5000, status: 'COMPLETED' },
      { workType: 'assembly', actualQty: 5000, status: 'COMPLETED' },
      { workType: 'welding', actualQty: 5000, status: 'COMPLETED' },
      { workType: 'painting', actualQty: 5000, status: 'COMPLETED' },
      { workType: 'inspection', actualQty: 5000, status: 'COMPLETED' },
    ] as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)

    const result = await rollUpWorkOrder('wo1')

    expect(result?.completedQty).toBe(5000)
    expect(result?.earnedQty).toBe(5000)
    expect(result?.weightedPct).toBeCloseTo(1.0)
  })

  it('earnedQty = 0 when no inspection stage completed', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 3000 as any, status: 'IN_PROGRESS' } as any)
    prismaMock.jobCard.findMany.mockResolvedValue([
      { workType: 'cutting', actualQty: 3000, status: 'COMPLETED' },
      { workType: 'assembly', actualQty: 3000, status: 'COMPLETED' },
      { workType: 'welding', actualQty: 3000, status: 'COMPLETED' },
      { workType: 'painting', actualQty: 3000, status: 'COMPLETED' },
    ] as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)

    const result = await rollUpWorkOrder('wo1')

    expect(result?.completedQty).toBe(2550)
    expect(result?.earnedQty).toBe(0)
  })

  it('caps completedQty at plannedWeight', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 100 as any, status: 'IN_PROGRESS' } as any)
    prismaMock.jobCard.findMany.mockResolvedValue([
      { workType: 'cutting', actualQty: 200, status: 'COMPLETED' },
      { workType: 'assembly', actualQty: 200, status: 'COMPLETED' },
      { workType: 'welding', actualQty: 200, status: 'COMPLETED' },
      { workType: 'painting', actualQty: 200, status: 'COMPLETED' },
      { workType: 'inspection', actualQty: 200, status: 'COMPLETED' },
    ] as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)

    const result = await rollUpWorkOrder('wo1')

    expect(result?.completedQty).toBe(100)
  })

  it('calls workOrder.update with correct values', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({ id: 'wo1', plannedWeight: 1000 as any, status: 'IN_PROGRESS' } as any)
    prismaMock.jobCard.findMany.mockResolvedValue([
      { workType: 'cutting', actualQty: 1000, status: 'COMPLETED' },
    ] as any)
    prismaMock.workOrder.update.mockResolvedValue({} as any)

    await rollUpWorkOrder('wo1')

    expect(prismaMock.workOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo1' },
      data: { completedQty: 100, earnedQty: 0 },
    })
  })
})
