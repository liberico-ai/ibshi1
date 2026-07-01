import { describe, it, expect, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { isWorkOrderQcPassed, getPieceMarkQcStatus } from '@/lib/qc-gate'

describe('isWorkOrderQcPassed', () => {
  beforeEach(() => {
    prismaMock.weldJoint.count.mockResolvedValue(0)
    prismaMock.weldJoint.findMany.mockResolvedValue([])
  })

  it('returns passed=true when WO is clean (no failures, no open NCRs)', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING',
    } as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('C1: fails when WeldJoint has ndtStatus=FAILED and no NCR', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING',
    } as never)
    prismaMock.weldJoint.count.mockResolvedValue(2)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('NDT lỗi chưa có NCR'))
  })

  it('C2: fails when WeldJoint has open NCR (not CLOSED/CANCELLED)', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING',
    } as never)
    prismaMock.weldJoint.findMany.mockResolvedValue([
      { jointNo: 'J-01', ncr: { ncrCode: 'NCR-001', status: 'OPEN' } },
    ] as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('NCR chưa đóng'))
    expect(result.reasons).toContainEqual(expect.stringContaining('NCR-001'))
  })

  it('C3: fails when WO status is QC_FAILED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_FAILED',
    } as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('QC_FAILED'))
  })

  it('passes when NCRs are all CLOSED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING',
    } as never)
    // C2 query returns empty (NCRs are closed)
    prismaMock.weldJoint.findMany.mockResolvedValue([])

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(true)
  })

  it('fails with multiple reasons when C1+C2+C3 all fail', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_FAILED',
    } as never)
    prismaMock.weldJoint.count.mockResolvedValue(1)
    prismaMock.weldJoint.findMany.mockResolvedValue([
      { jointNo: 'J-02', ncr: { ncrCode: 'NCR-002', status: 'IN_PROGRESS' } },
    ] as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toHaveLength(3)
  })

  it('returns not passed for non-existent WO', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue(null)

    const result = await isWorkOrderQcPassed('wo-missing')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('không tồn tại'))
  })
})

describe('getPieceMarkQcStatus', () => {
  beforeEach(() => {
    prismaMock.weldJoint.count.mockResolvedValue(0)
    prismaMock.weldJoint.findMany.mockResolvedValue([])
  })

  it('returns FAILED when WO status is QC_FAILED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'QC_FAILED',
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('FAILED')
  })

  it('returns PASSED when WO is QC_PASSED and all checks clean', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'QC_PASSED' } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'QC_PASSED' } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PASSED')
  })

  it('returns PASSED when WO is COMPLETED and all checks clean', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'COMPLETED' } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'COMPLETED' } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PASSED')
  })

  it('returns FAILED when WO is QC_PASSED but has open NCR', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'QC_PASSED' } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'QC_PASSED' } as never)
    prismaMock.weldJoint.findMany.mockResolvedValue([
      { jointNo: 'J-01', ncr: { ncrCode: 'NCR-001', status: 'OPEN' } },
    ] as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('FAILED')
  })

  it('returns PENDING when WO is IN_PROGRESS', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'IN_PROGRESS',
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PENDING')
  })

  it('returns PENDING when WO is QC_PENDING', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'QC_PENDING',
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PENDING')
  })

  it('returns PENDING for non-existent WO', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue(null)

    expect(await getPieceMarkQcStatus('wo-missing')).toBe('PENDING')
  })
})
