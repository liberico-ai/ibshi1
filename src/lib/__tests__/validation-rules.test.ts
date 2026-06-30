/**
 * Tests for validation-rules.ts — P0 audit fix.
 * Verifies rules fire against prisma.task (not dead workflowTask table).
 *
 * Scenarios:
 *   1. TC-03-05 budget overrun: PO > estimate → warning
 *   2. TC-03-05 budget OK: PO <= estimate → no warning
 *   3. TC-03-05 no P1.2 task → no warning (graceful)
 *   4. Attachment validator: missing file → blocks
 *   5. Attachment validator: file exists → passes
 *   6. Attachment validator: no task found → passes (graceful)
 */
import { describe, it, expect } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { runValidationRules } from '@/lib/validation-rules'

const PROJECT_ID = 'proj-val-01'

describe('TC-03-05: Budget Overrun (validateBudgetOverrun)', () => {
  it('warns when PO total exceeds estimate', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      resultData: { totalEstimate: 100_000_000 },
    } as never)

    // bgd_approved=true to bypass TC-03-06 PO gate (isolate budget overrun test)
    const result = await runValidationRules('P3.7', {
      poTotalValue: 120_000_000,
      checklist: { bgd_approved: true },
    }, PROJECT_ID)

    expect(result.valid).toBe(true) // warning only, not blocking
    expect(result.warnings.some(w => w.includes('VƯỢT NGÂN SÁCH'))).toBe(true)
    expect(result.warnings.some(w => w.includes('+20.0%'))).toBe(true)
  })

  it('no warning when PO within estimate', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      resultData: { totalEstimate: 100_000_000 },
    } as never)

    const result = await runValidationRules('P3.7', {
      poTotalValue: 90_000_000,
      checklist: { bgd_approved: true },
    }, PROJECT_ID)

    expect(result.valid).toBe(true)
    expect(result.warnings.filter(w => w.includes('VƯỢT NGÂN SÁCH'))).toHaveLength(0)
  })

  it('no warning when P1.2 task not found', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(null)

    const result = await runValidationRules('P3.7', {
      poTotalValue: 120_000_000,
      checklist: { bgd_approved: true },
    }, PROJECT_ID)

    expect(result.valid).toBe(true)
    expect(result.warnings.filter(w => w.includes('VƯỢT NGÂN SÁCH'))).toHaveLength(0)
  })

  it('TC-03-06 blocks PO >50M without BGĐ approval', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(null)

    const result = await runValidationRules('P3.7', { poTotalValue: 60_000_000 }, PROJECT_ID)

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('TC-03-06'))).toBe(true)
  })

  it('queries prisma.task with taskType=P1.2, not workflowTask', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(null)

    await runValidationRules('P3.7', {}, PROJECT_ID)

    expect(prismaMock.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskType: 'P1.2', status: 'DONE' }),
      })
    )
  })
})

describe('Attachment Validator (makeAttachmentValidator)', () => {
  it('blocks when required file is missing', async () => {
    // P2.1 calls makeAttachmentValidator('P2.1', [{key:'drawings', label:'File bản vẽ (DWG/PDF)'}])
    // First findFirst: task lookup
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'task-p21' } as never)
    // BOM items for BOM consistency check
    prismaMock.bomItem.findMany.mockResolvedValueOnce([])
    // Second findFirst: file attachment lookup
    prismaMock.fileAttachment.findFirst.mockResolvedValueOnce(null)

    const result = await runValidationRules('P2.1', {}, PROJECT_ID)

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('File bản vẽ (DWG/PDF)'))).toBe(true)
  })

  it('passes when required file exists', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'task-p21' } as never)
    prismaMock.bomItem.findMany.mockResolvedValueOnce([])
    prismaMock.fileAttachment.findFirst.mockResolvedValueOnce({ id: 'file-1' } as never)

    const result = await runValidationRules('P2.1', {}, PROJECT_ID)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('passes gracefully when task not found', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(null)
    prismaMock.bomItem.findMany.mockResolvedValueOnce([])

    const result = await runValidationRules('P2.1', {}, PROJECT_ID)

    // BOM consistency is also OK (no items), attachment validator returns OK (no task)
    expect(result.valid).toBe(true)
  })

  it('uses entityId = taskId_slotKey for file lookup', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({ id: 'task-xyz' } as never)
    prismaMock.bomItem.findMany.mockResolvedValueOnce([])
    prismaMock.fileAttachment.findFirst.mockResolvedValueOnce(null)

    await runValidationRules('P2.1', {}, PROJECT_ID)

    expect(prismaMock.fileAttachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityId: 'task-xyz_drawings' },
      })
    )
  })

  it('queries prisma.task with taskType=stepCode, not workflowTask', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce(null)
    prismaMock.bomItem.findMany.mockResolvedValueOnce([])

    await runValidationRules('P2.1', {}, PROJECT_ID)

    expect(prismaMock.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ taskType: 'P2.1' }),
      })
    )
  })
})

describe('Step without rules', () => {
  it('returns valid for unmapped step', async () => {
    const result = await runValidationRules('P99.99', {}, PROJECT_ID)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})
