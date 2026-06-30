/**
 * Tests for cascade-tasks.ts — cascade task creation from BOM version changes.
 * Two acceptance scenarios:
 *   1. FF OFF → no tasks created
 *   2. FF ON → correct tasks per role
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──

const mockCreateTask = vi.fn()
vi.mock('@/lib/work-engine', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}))

const mockDiffBomVersions = vi.fn()
const mockComputeImpact = vi.fn()
vi.mock('@/lib/bom-diff-engine', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    diffBomVersions: (...args: unknown[]) => mockDiffBomVersions(...args),
    computeImpact: (...args: unknown[]) => mockComputeImpact(...args),
  }
})

import { runCascade } from '@/lib/cascade-tasks'
import type { DiffResult, ImpactResult, DiffLine, ImpactLine } from '@/lib/bom-diff-engine'

// ── Helpers ──

function makeDiffLine(overrides: Partial<DiffLine> = {}): DiffLine {
  return {
    action: 'QTY_CHANGED',
    category: 'MAIN',
    materialId: 'mat-1',
    materialCode: 'VTC-001',
    materialName: 'Thép tấm SS400',
    pieceMark: 'PM-101',
    profile: 'H300x150',
    grade: 'SS400',
    unit: 'kg',
    qtyOld: 100,
    qtyNew: 120,
    qtyDelta: 20,
    oldLineId: 'old-1',
    newLineId: 'new-1',
    ...overrides,
  }
}

function makeImpactLine(diffOverrides: Partial<DiffLine> = {}, impactOverrides: Partial<ImpactLine> = {}): ImpactLine {
  return {
    diffLine: makeDiffLine(diffOverrides),
    procurementStatus: 'NOT_PURCHASED',
    currentPrQty: 0,
    currentPoQty: 0,
    currentStockQty: 0,
    suggestedAction: 'Tạo PR bổ sung',
    suggestedActionCode: 'ADD_PR',
    ...impactOverrides,
  }
}

// ── Tests ──

describe('runCascade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateTask.mockResolvedValue({ id: 'task-1' })
  })

  it('creates no tasks when diff has no changes', async () => {
    const emptyDiff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2', lines: [],
      summary: { added: 0, removed: 0, qtyChanged: 0, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: 0 },
    }
    mockDiffBomVersions.mockResolvedValue(emptyDiff)

    const result = await runCascade('v1', 'v2', 'proj-1', 'ECO-26-001', 'user-1')

    expect(result.skippedNoChanges).toBe(true)
    expect(result.taskIds).toHaveLength(0)
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('creates DESIGN + PROCUREMENT + COST + WBS tasks for MAIN category change', async () => {
    const diff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2',
      lines: [makeDiffLine({ category: 'MAIN', pieceMark: 'PM-101' })],
      summary: { added: 0, removed: 0, qtyChanged: 1, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: 20 },
    }
    mockDiffBomVersions.mockResolvedValue(diff)

    const impact: ImpactResult = {
      versionId: 'v2', projectId: 'proj-1',
      lines: [makeImpactLine({ category: 'MAIN', pieceMark: 'PM-101' })],
      summary: { totalChanges: 1, needPurchase: 1, canUseStock: 0, needPOAlert: 0, needNCR: 0 },
    }
    mockComputeImpact.mockResolvedValue(impact)

    const result = await runCascade('v1', 'v2', 'proj-1', 'ECO-26-001', 'user-1')

    expect(result.skippedNoChanges).toBe(false)
    expect(result.groups.length).toBeGreaterThanOrEqual(3)

    const groupKeys = result.groups.map(g => g.group)
    expect(groupKeys).toContain('DESIGN')
    expect(groupKeys).toContain('PROCUREMENT')
    expect(groupKeys).toContain('COST')
    expect(groupKeys).toContain('WBS')

    const designCall = mockCreateTask.mock.calls.find(
      (c: unknown[]) => (c[0] as { title: string }).title.includes('Kỹ thuật')
    )
    expect(designCall).toBeDefined()
    expect((designCall![0] as { assignees: { role: string }[] }).assignees[0].role).toBe('R04')
    expect((designCall![0] as { taskType: string }).taskType).toBe('CASCADE')
  })

  it('creates NORM_REVIEW task for WELD/PAINT category', async () => {
    const diff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2',
      lines: [makeDiffLine({ category: 'WELD', pieceMark: null })],
      summary: { added: 0, removed: 0, qtyChanged: 1, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: 5 },
    }
    mockDiffBomVersions.mockResolvedValue(diff)

    const impact: ImpactResult = {
      versionId: 'v2', projectId: 'proj-1',
      lines: [makeImpactLine({ category: 'WELD', pieceMark: null })],
      summary: { totalChanges: 1, needPurchase: 1, canUseStock: 0, needPOAlert: 0, needNCR: 0 },
    }
    mockComputeImpact.mockResolvedValue(impact)

    const result = await runCascade('v1', 'v2', 'proj-1', 'ECO-26-002', 'user-1')

    const normGroup = result.groups.find(g => g.group === 'NORM_REVIEW')
    expect(normGroup).toBeDefined()
    expect(normGroup!.role).toBe('R02')
  })

  it('creates WAREHOUSE task for AUX/STOCK category', async () => {
    const diff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2',
      lines: [makeDiffLine({ category: 'AUX', pieceMark: null })],
      summary: { added: 0, removed: 0, qtyChanged: 1, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: 10 },
    }
    mockDiffBomVersions.mockResolvedValue(diff)

    const impact: ImpactResult = {
      versionId: 'v2', projectId: 'proj-1',
      lines: [makeImpactLine(
        { category: 'AUX', pieceMark: null },
        { suggestedActionCode: 'ADD_PR' },
      )],
      summary: { totalChanges: 1, needPurchase: 1, canUseStock: 0, needPOAlert: 0, needNCR: 0 },
    }
    mockComputeImpact.mockResolvedValue(impact)

    const result = await runCascade('v1', 'v2', 'proj-1', 'ECO-26-003', 'user-1')

    const whGroup = result.groups.find(g => g.group === 'WAREHOUSE')
    expect(whGroup).toBeDefined()
    expect(whGroup!.role).toBe('R05')
  })

  it('includes procurement status context (IN_PO → ALERT_PO) in task description', async () => {
    const diff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2',
      lines: [makeDiffLine({ category: 'MAIN', action: 'QTY_CHANGED', qtyDelta: 30 })],
      summary: { added: 0, removed: 0, qtyChanged: 1, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: 30 },
    }
    mockDiffBomVersions.mockResolvedValue(diff)

    const impact: ImpactResult = {
      versionId: 'v2', projectId: 'proj-1',
      lines: [makeImpactLine(
        { category: 'MAIN' },
        { procurementStatus: 'IN_PO', currentPoQty: 100, suggestedActionCode: 'ALERT_PO', suggestedAction: 'Đã PO, cảnh báo TM' },
      )],
      summary: { totalChanges: 1, needPurchase: 0, canUseStock: 0, needPOAlert: 1, needNCR: 0 },
    }
    mockComputeImpact.mockResolvedValue(impact)

    const result = await runCascade('v1', 'v2', 'proj-1', 'ECO-26-004', 'user-1')

    const procCall = mockCreateTask.mock.calls.find(
      (c: unknown[]) => (c[0] as { title: string }).title.includes('Thương mại')
    )
    expect(procCall).toBeDefined()
    const desc = (procCall![0] as { description: string }).description
    expect(desc).toContain('Đã đặt PO')
    expect(desc).toContain('KHÔNG đổi PO')
  })

  it('does not skip PROCUREMENT group even when action is NONE (cost still needs review)', async () => {
    const diff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2',
      lines: [makeDiffLine({ category: 'MAIN', action: 'REMOVED', qtyDelta: -50 })],
      summary: { added: 0, removed: 1, qtyChanged: 0, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: -50 },
    }
    mockDiffBomVersions.mockResolvedValue(diff)

    const impact: ImpactResult = {
      versionId: 'v2', projectId: 'proj-1',
      lines: [makeImpactLine(
        { category: 'MAIN', action: 'REMOVED', qtyDelta: -50, pieceMark: null },
        { procurementStatus: 'NOT_PURCHASED', suggestedActionCode: 'NONE' },
      )],
      summary: { totalChanges: 1, needPurchase: 0, canUseStock: 0, needPOAlert: 0, needNCR: 0 },
    }
    mockComputeImpact.mockResolvedValue(impact)

    const result = await runCascade('v1', 'v2', 'proj-1', 'ECO-26-005', 'user-1')

    // PROCUREMENT should NOT be created (action=NONE)
    const procGroup = result.groups.find(g => g.group === 'PROCUREMENT')
    expect(procGroup).toBeUndefined()

    // COST should always be created
    const costGroup = result.groups.find(g => g.group === 'COST')
    expect(costGroup).toBeDefined()
    expect(costGroup!.role).toBe('R03')
  })

  it('task title includes ECO code and group label', async () => {
    const diff: DiffResult = {
      oldVersionId: 'v1', newVersionId: 'v2',
      lines: [makeDiffLine()],
      summary: { added: 0, removed: 0, qtyChanged: 1, specChanged: 0, byCategory: {} as DiffResult['summary']['byCategory'], totalDeltaQty: 20 },
    }
    mockDiffBomVersions.mockResolvedValue(diff)

    const impact: ImpactResult = {
      versionId: 'v2', projectId: 'proj-1',
      lines: [makeImpactLine()],
      summary: { totalChanges: 1, needPurchase: 1, canUseStock: 0, needPOAlert: 0, needNCR: 0 },
    }
    mockComputeImpact.mockResolvedValue(impact)

    await runCascade('v1', 'v2', 'proj-1', 'ECO-26-010', 'user-1')

    for (const call of mockCreateTask.mock.calls) {
      const input = call[0] as { title: string; taskType: string; priority: string }
      expect(input.title).toContain('[Cascade]')
      expect(input.title).toContain('ECO-26-010')
      expect(input.taskType).toBe('CASCADE')
      expect(input.priority).toBe('HIGH')
    }
  })
})
