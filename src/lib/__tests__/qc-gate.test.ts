import { describe, it, expect, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { isWorkOrderQcPassed, getPieceMarkQcStatus } from '@/lib/qc-gate'

describe('isWorkOrderQcPassed', () => {
  beforeEach(() => {
    prismaMock.weldJoint.count.mockResolvedValue(0)
    prismaMock.weldJoint.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.count.mockResolvedValue(0)
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([])
  })

  it('returns passed=true when WO is clean (no failures, no open NCRs)', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('C1: fails when WeldJoint has ndtStatus=FAILED and no NCR', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    prismaMock.weldJoint.count.mockResolvedValue(2)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('NDT lỗi chưa có NCR'))
  })

  it('C2: fails when WeldJoint has open NCR (not CLOSED/CANCELLED)', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
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
      id: 'wo-1', woCode: 'WO-001', status: 'QC_FAILED', needsReQc: false, reQcReason: null,
    } as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('QC_FAILED'))
  })

  it('passes when NCRs are all CLOSED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    // C2 query returns empty (NCRs are closed)
    prismaMock.weldJoint.findMany.mockResolvedValue([])

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(true)
  })

  it('fails with multiple reasons when C1+C2+C3 all fail', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_FAILED', needsReQc: false, reQcReason: null,
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

  it('C4: fails when ITP checkpoint HOLD/WITNESS is FAILED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    prismaMock.iTPCheckpoint.count.mockResolvedValue(1)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('điểm dừng ITP'))
    expect(result.reasons).toContainEqual(expect.stringContaining('chưa đạt'))
  })

  it('C5: fails when ITP checkpoint HOLD/WITNESS is PENDING and ITP not DRAFT', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([
      { id: 'cp-1' },
      { id: 'cp-2' },
    ] as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('chưa kiểm tra'))
    expect(result.reasons).toContainEqual(expect.stringContaining('2'))
  })

  it('C6: fails when Inspection linked to WO is FAILED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    prismaMock.inspection.findMany.mockResolvedValue([
      { inspectionCode: 'INS-001' },
    ] as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('Biên bản QC lỗi'))
    expect(result.reasons).toContainEqual(expect.stringContaining('INS-001'))
  })

  it('C6: fails when Inspection has checklistItem with result=FAIL', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    prismaMock.inspection.findMany.mockResolvedValue([
      { inspectionCode: 'INS-002' },
    ] as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('INS-002'))
  })

  it('null-skip: C4/C5/C6 do not block WO when records have no workOrderId', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-clean', woCode: 'WO-CLEAN', status: 'QC_PENDING', needsReQc: false, reQcReason: null,
    } as never)
    // All C4/C5/C6 queries filter by workOrderId — records with projectId-only won't match
    // Default mocks return 0/[] which simulates this correctly

    const result = await isWorkOrderQcPassed('wo-clean')
    expect(result.passed).toBe(true)
    expect(result.reasons).toEqual([])
  })
})

describe('getPieceMarkQcStatus', () => {
  beforeEach(() => {
    prismaMock.weldJoint.count.mockResolvedValue(0)
    prismaMock.weldJoint.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.count.mockResolvedValue(0)
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([])
  })

  it('returns FAILED when WO status is QC_FAILED', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'QC_FAILED', needsReQc: false,
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('FAILED')
  })

  it('returns PASSED when WO is QC_PASSED and all checks clean', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'QC_PASSED', needsReQc: false } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'QC_PASSED', needsReQc: false, reQcReason: null } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PASSED')
  })

  it('returns PASSED when WO is COMPLETED and all checks clean', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'COMPLETED', needsReQc: false } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'COMPLETED', needsReQc: false, reQcReason: null } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PASSED')
  })

  it('returns FAILED when WO is QC_PASSED but has open NCR', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'QC_PASSED', needsReQc: false } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'QC_PASSED', needsReQc: false, reQcReason: null } as never)
    prismaMock.weldJoint.findMany.mockResolvedValue([
      { jointNo: 'J-01', ncr: { ncrCode: 'NCR-001', status: 'OPEN' } },
    ] as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('FAILED')
  })

  it('returns PENDING when WO is IN_PROGRESS', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'IN_PROGRESS', needsReQc: false,
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PENDING')
  })

  it('returns PENDING when WO is QC_PENDING', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'QC_PENDING', needsReQc: false,
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PENDING')
  })

  it('returns PENDING for non-existent WO', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue(null)

    expect(await getPieceMarkQcStatus('wo-missing')).toBe('PENDING')
  })

  it('C0: fails when needsReQc=true', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', woCode: 'WO-001', status: 'QC_PASSED', needsReQc: true, reQcReason: 'Re-QC do ECO-001',
    } as never)

    const result = await isWorkOrderQcPassed('wo-1')
    expect(result.passed).toBe(false)
    expect(result.reasons).toContainEqual(expect.stringContaining('re-QC'))
    expect(result.reasons).toContainEqual(expect.stringContaining('ECO-001'))
  })

  it('C0: getPieceMarkQcStatus returns FAILED when needsReQc=true', async () => {
    prismaMock.workOrder.findUnique.mockResolvedValue({
      id: 'wo-1', status: 'QC_PASSED', needsReQc: true,
    } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('FAILED')
  })

  it('C0: QC_PASSED clears needsReQc → PASSED', async () => {
    prismaMock.workOrder.findUnique
      .mockResolvedValueOnce({ id: 'wo-1', status: 'QC_PASSED', needsReQc: false } as never)
      .mockResolvedValueOnce({ id: 'wo-1', woCode: 'WO-001', status: 'QC_PASSED', needsReQc: false, reQcReason: null } as never)

    expect(await getPieceMarkQcStatus('wo-1')).toBe('PASSED')
  })
})
