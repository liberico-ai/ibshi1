import { describe, it, expect } from 'vitest'
import { aggregateMcl, normCode, type MclAggregateInput } from '@/lib/mcl'

function baseInput(overrides: Partial<MclAggregateInput> = {}): MclAggregateInput {
  return {
    prItems: [],
    bomItems: [],
    poItems: [],
    stocks: [],
    issues: [],
    codeToMaterialId: new Map(),
    ...overrides,
  }
}

describe('normCode', () => {
  it('trims and uppercases', () => {
    expect(normCode('  vt-001 ')).toBe('VT-001')
    expect(normCode(null)).toBe('')
    expect(normCode(undefined)).toBe('')
  })
})

describe('aggregateMcl', () => {
  it('returns empty for empty input', () => {
    expect(aggregateMcl(baseInput())).toEqual([])
  })

  it('gộp PR + PO + tồn + cấp theo materialId; tính còn thiếu', () => {
    const rows = aggregateMcl(baseInput({
      prItems: [{ materialId: 'm1', itemCode: 'VT-001', description: 'Thép tấm', unit: 'kg', quantity: 100 }],
      poItems: [{ materialId: 'm1', ordered: 60, received: 40 }],
      stocks: [{ materialId: 'm1', quantity: 20, materialCode: 'VT-001', materialName: 'Thép tấm', unit: 'kg' }],
      issues: [{ materialId: 'm1', quantity: 5 }],
    }))
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.needed).toBe(100)
    expect(r.ordered).toBe(60)
    expect(r.received).toBe(40)
    expect(r.onHand).toBe(20)
    expect(r.issued).toBe(5)
    // shortage = needed - onHand - (ordered - received) = 100 - 20 - (60-40) = 60
    expect(r.shortage).toBe(60)
  })

  it('BOM là nguồn Cần fallback khi không có PR', () => {
    const rows = aggregateMcl(baseInput({
      bomItems: [{ materialId: 'm2', quantity: 30, materialCode: 'VT-002', materialName: 'Bulong', unit: 'cái' }],
    }))
    expect(rows[0].needed).toBe(30)
    expect(rows[0].neededBom).toBe(30)
    expect(rows[0].neededPr).toBe(0)
  })

  it('PR ưu tiên hơn BOM khi cả hai cùng vật tư', () => {
    const rows = aggregateMcl(baseInput({
      prItems: [{ materialId: 'm3', quantity: 50 }],
      bomItems: [{ materialId: 'm3', quantity: 40 }],
    }))
    expect(rows[0].neededPr).toBe(50)
    expect(rows[0].neededBom).toBe(40)
    expect(rows[0].needed).toBe(50)
  })

  it('hợp nhất dòng snapshot (materialId null) với dòng có material qua codeToMaterialId', () => {
    const rows = aggregateMcl(baseInput({
      prItems: [{ materialId: 'm4', itemCode: 'VT-004', quantity: 10 }],
      // PO snapshot: materialId null nhưng itemCode trùng → phải gộp chung với m4
      poItems: [{ materialId: null, itemCode: 'vt-004', ordered: 10, received: 0 }],
      codeToMaterialId: new Map([['VT-004', 'm4']]),
    }))
    expect(rows).toHaveLength(1)
    expect(rows[0].needed).toBe(10)
    expect(rows[0].ordered).toBe(10)
  })

  it('dòng snapshot không resolve được thì gộp theo itemCode chuẩn hoá', () => {
    const rows = aggregateMcl(baseInput({
      poItems: [
        { materialId: null, itemCode: 'ABC', ordered: 5, received: 0 },
        { materialId: null, itemCode: 'abc', ordered: 5, received: 0 },
      ],
      codeToMaterialId: new Map(),
    }))
    expect(rows).toHaveLength(1)
    expect(rows[0].ordered).toBe(10)
  })

  it('shortage không âm khi đã phủ đủ', () => {
    const rows = aggregateMcl(baseInput({
      prItems: [{ materialId: 'm5', quantity: 10 }],
      stocks: [{ materialId: 'm5', quantity: 100 }],
    }))
    expect(rows[0].shortage).toBe(0)
  })

  it('sắp xếp theo còn thiếu giảm dần', () => {
    const rows = aggregateMcl(baseInput({
      prItems: [
        { materialId: 'a', quantity: 5 },
        { materialId: 'b', quantity: 100 },
      ],
    }))
    expect(rows[0].materialId).toBe('b')
    expect(rows[1].materialId).toBe('a')
  })
})
