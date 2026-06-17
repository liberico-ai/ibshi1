/**
 * Unit tests for src/lib/material-code.ts — canonical code generator.
 * The transaction client is a plain stub (no DB).
 */
import { describe, it, expect, vi } from 'vitest'
import { generateMaterialCode } from '@/lib/material-code'

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    materialCodeCounter: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ lastSeq: 1 }),
    },
    material: { findMany: vi.fn().mockResolvedValue([]) },
    materialCodeAlias: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  } as any
}

describe('generateMaterialCode', () => {
  it('seeds from highest existing seq (materialCode + alias) on first use, then increments', async () => {
    const tx = makeTx()
    tx.materialCodeCounter.findUnique.mockResolvedValue(null) // first use
    tx.material.findMany.mockResolvedValue([{ materialCode: 'VLH-QUEH-007' }])
    tx.materialCodeAlias.findMany.mockResolvedValue([{ aliasCode: 'VLH-QUEH-009' }])
    tx.materialCodeCounter.update.mockResolvedValue({ lastSeq: 10 })

    const code = await generateMaterialCode(tx, 'VLH', 'QUEH')

    // seeded at max(7,9) = 9
    expect(tx.materialCodeCounter.create).toHaveBeenCalledWith({ data: { prefix: 'VLH', subgroup: 'QUEH', lastSeq: 9 } })
    expect(code).toBe('VLH-QUEH-010')
  })

  it('does not re-seed when counter already exists', async () => {
    const tx = makeTx()
    tx.materialCodeCounter.findUnique.mockResolvedValue({ prefix: 'VLP', subgroup: 'SONP', lastSeq: 41 })
    tx.materialCodeCounter.update.mockResolvedValue({ lastSeq: 42 })

    const code = await generateMaterialCode(tx, 'VLP', 'SONP')

    expect(tx.material.findMany).not.toHaveBeenCalled()
    expect(tx.materialCodeCounter.create).not.toHaveBeenCalled()
    expect(code).toBe('VLP-SONP-042')
  })

  it('pads sequence to 3 digits and starts at 001 for an empty group', async () => {
    const tx = makeTx()
    tx.materialCodeCounter.findUnique.mockResolvedValue(null)
    tx.material.findMany.mockResolvedValue([])
    tx.materialCodeAlias.findMany.mockResolvedValue([])
    tx.materialCodeCounter.update.mockResolvedValue({ lastSeq: 1 })

    const code = await generateMaterialCode(tx, 'BAH', 'GTAY')
    expect(tx.materialCodeCounter.create).toHaveBeenCalledWith({ data: { prefix: 'BAH', subgroup: 'GTAY', lastSeq: 0 } })
    expect(code).toBe('BAH-GTAY-001')
  })

  it('ignores non-numeric seq tails when seeding', async () => {
    const tx = makeTx()
    tx.materialCodeCounter.findUnique.mockResolvedValue(null)
    tx.material.findMany.mockResolvedValue([{ materialCode: 'VLC-THEP-16060' }, { materialCode: 'VLC-THEP-M1' }])
    tx.materialCodeAlias.findMany.mockResolvedValue([])
    tx.materialCodeCounter.update.mockResolvedValue({ lastSeq: 16061 })

    const code = await generateMaterialCode(tx, 'VLC', 'THEP')
    expect(tx.materialCodeCounter.create).toHaveBeenCalledWith({ data: { prefix: 'VLC', subgroup: 'THEP', lastSeq: 16060 } })
    expect(code).toBe('VLC-THEP-16061')
  })
})
