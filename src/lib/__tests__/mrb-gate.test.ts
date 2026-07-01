import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db')

import { prismaMock } from '@/lib/__mocks__/db'
import { computeMrbGate } from '../mrb-gate'

const PID = 'proj-1'

describe('computeMrbGate', () => {
  it('PASS khi không có blocker và có FAT PASSED', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(1)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it('BLOCK khi có NCR mở', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([
      { ncrCode: 'NCR-001', status: 'OPEN' },
    ] as never)
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(false)
    expect(result.blockers.some(b => b.includes('NCR'))).toBe(true)
  })

  it('BLOCK khi ITP checkpoint FAILED', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([
      { id: 'cp1', status: 'FAILED' },
    ] as never)
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(false)
    expect(result.blockers.some(b => b.includes('ITP checkpoint FAILED'))).toBe(true)
  })

  it('BLOCK khi ITP checkpoint PENDING', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([
      { id: 'cp1', status: 'PENDING' },
    ] as never)
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(false)
    expect(result.blockers.some(b => b.includes('PENDING'))).toBe(true)
  })

  it('BLOCK khi Inspection FAILED', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
      { id: 'i2', inspectionCode: 'INS-002', type: 'VISUAL', status: 'FAILED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(false)
    expect(result.blockers.some(b => b.includes('inspection FAILED'))).toBe(true)
  })

  it('BLOCK khi Inspection PENDING', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
      { id: 'i2', inspectionCode: 'INS-002', type: 'VISUAL', status: 'PENDING' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(false)
    expect(result.blockers.some(b => b.includes('inspection PENDING'))).toBe(true)
  })

  it('BLOCK khi thiếu FAT PASSED', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'VISUAL', status: 'PASSED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(false)
    expect(result.blockers.some(b => b.includes('FAT'))).toBe(true)
  })

  it('warning mềm khi thiếu cert', async () => {
    prismaMock.nonConformanceReport.findMany.mockResolvedValue([])
    prismaMock.iTPCheckpoint.findMany.mockResolvedValue([])
    prismaMock.inspection.findMany.mockResolvedValue([
      { id: 'i1', inspectionCode: 'INS-001', type: 'FAT', status: 'PASSED' },
    ] as never)
    prismaMock.certificateRegistry.count.mockResolvedValue(0)

    const result = await computeMrbGate(PID)
    expect(result.canRelease).toBe(true)
    expect(result.warnings.some(w => w.includes('chứng chỉ'))).toBe(true)
  })
})
