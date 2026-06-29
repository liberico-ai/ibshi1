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

describe('rollUpWorkOrder', () => {
  beforeEach(() => {
    prismaMock.workOrder.findUnique.mockReset()
    prismaMock.jobCard.findMany.mockReset()
    prismaMock.workOrder.update.mockReset()
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
