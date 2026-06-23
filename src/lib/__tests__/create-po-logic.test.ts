import { describe, it, expect } from 'vitest'

interface PrItem {
  stt?: string
  canonicalCode?: string
  description?: string
  profile?: string
  grade?: string
  unit?: string
  needToBuyQty?: number
}

interface QuoteLine {
  matchedPrIndex: number | null
  unitPrice: number
  code?: string
  description?: string
  profile?: string
  grade?: string
  unit?: string
}

function buildPoItems(prItems: PrItem[], quoteLines: QuoteLine[]) {
  const poItems: Array<{
    itemCode: string; description: string; profile: string; grade: string;
    unit: string; quantity: number; unitPrice: number;
  }> = []

  for (const line of quoteLines) {
    if (line.matchedPrIndex == null) continue
    const prItem = prItems[line.matchedPrIndex]
    if (!prItem) continue
    const needToBuy = typeof prItem.needToBuyQty === 'number' ? prItem.needToBuyQty : 0
    if (needToBuy <= 0) continue

    poItems.push({
      itemCode: prItem.canonicalCode || prItem.stt || line.code || '',
      description: prItem.description || line.description || '',
      profile: prItem.profile || line.profile || '',
      grade: prItem.grade || line.grade || '',
      unit: prItem.unit || line.unit || '',
      quantity: needToBuy,
      unitPrice: line.unitPrice,
    })
  }

  return poItems
}

describe('create-po logic — buildPoItems', () => {
  it('only includes lines with needToBuyQty > 0', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', unit: 'cây', needToBuyQty: 60 },
      { stt: '002', description: 'Thép H', unit: 'cây', needToBuyQty: 0 },
      { stt: '003', description: 'Tôn tấm', unit: 'tấm', needToBuyQty: 20 },
    ]
    const quoteLines: QuoteLine[] = [
      { matchedPrIndex: 0, unitPrice: 50000 },
      { matchedPrIndex: 1, unitPrice: 80000 },
      { matchedPrIndex: 2, unitPrice: 120000 },
    ]

    const result = buildPoItems(prItems, quoteLines)
    expect(result).toHaveLength(2)
    expect(result[0].itemCode).toBe('001')
    expect(result[0].quantity).toBe(60)
    expect(result[1].itemCode).toBe('003')
    expect(result[1].quantity).toBe(20)
  })

  it('uses needToBuyQty as quantity (not PR full qty)', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', unit: 'cây', needToBuyQty: 40 },
    ]
    const quoteLines: QuoteLine[] = [
      { matchedPrIndex: 0, unitPrice: 100000 },
    ]

    const result = buildPoItems(prItems, quoteLines)
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(40)
    expect(result[0].unitPrice).toBe(100000)
  })

  it('returns empty when all items have sufficient stock', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', unit: 'cây', needToBuyQty: 0 },
      { stt: '002', description: 'Thép H', unit: 'cây', needToBuyQty: 0 },
    ]
    const quoteLines: QuoteLine[] = [
      { matchedPrIndex: 0, unitPrice: 50000 },
      { matchedPrIndex: 1, unitPrice: 80000 },
    ]

    const result = buildPoItems(prItems, quoteLines)
    expect(result).toHaveLength(0)
  })

  it('skips unmatched quote lines', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', unit: 'cây', needToBuyQty: 10 },
    ]
    const quoteLines: QuoteLine[] = [
      { matchedPrIndex: 0, unitPrice: 50000 },
      { matchedPrIndex: null, unitPrice: 999999 },
    ]

    const result = buildPoItems(prItems, quoteLines)
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(10)
  })

  it('uses PR item fields for snapshot', () => {
    const prItems: PrItem[] = [
      { stt: '001', canonicalCode: 'VTC-001', description: 'Thép chữ C', profile: 'C200x75', grade: 'SS400', unit: 'cây', needToBuyQty: 5 },
    ]
    const quoteLines: QuoteLine[] = [
      { matchedPrIndex: 0, unitPrice: 200000, code: 'X1', description: 'Steel C' },
    ]

    const result = buildPoItems(prItems, quoteLines)
    expect(result[0].itemCode).toBe('VTC-001')
    expect(result[0].description).toBe('Thép chữ C')
    expect(result[0].profile).toBe('C200x75')
    expect(result[0].grade).toBe('SS400')
    expect(result[0].unit).toBe('cây')
  })
})
