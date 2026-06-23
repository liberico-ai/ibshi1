import { describe, it, expect } from 'vitest'
import type { PrItem, QuoteLine } from '../quote-parser'

interface SupplierQuote {
  id: string
  vendorName: string
  totalAmount: number
  lines: QuoteLine[]
}

function computeMatrixTotals(prItems: PrItem[], quotes: SupplierQuote[]) {
  const hasBreakdown = prItems.some(p => typeof p.needToBuyQty === 'number')

  type Row = { prIdx: number; needToBuy: number; prices: Record<string, number> }
  const allRows: Row[] = prItems.map((p, pi) => {
    const prices: Record<string, number> = {}
    for (const q of quotes) {
      const match = q.lines.find(l => l.matchedPrIndex === pi)
      if (match) prices[q.id] = match.unitPrice
    }
    return {
      prIdx: pi,
      needToBuy: typeof p.needToBuyQty === 'number' ? p.needToBuyQty : (p.quantity || p.qty || 0),
      prices,
    }
  })

  const rows = hasBreakdown ? allRows.filter(r => r.needToBuy > 0) : allRows
  const skippedCount = allRows.length - rows.length

  const nccTotals: Record<string, number> = {}
  for (const q of quotes) {
    let total = 0
    for (const r of rows) {
      const price = r.prices[q.id]
      if (price !== undefined && price > 0) total += r.needToBuy * price
    }
    nccTotals[q.id] = Math.round(total)
  }

  let cheapestId = ''
  let cheapestTotal = Infinity
  for (const [qid, total] of Object.entries(nccTotals)) {
    if (total > 0 && total < cheapestTotal) { cheapestTotal = total; cheapestId = qid }
  }

  return { rows, skippedCount, nccTotals, cheapestId, cheapestTotal, hasBreakdown }
}

describe('MaterialMatrix logic — needToBuyQty', () => {
  const makeLine = (matchedPrIndex: number | null, unitPrice: number, qty = 10): QuoteLine => ({
    code: '', description: '', profile: '', grade: '', unit: '',
    qty, unitPrice, amount: qty * unitPrice,
    matchedPrIndex, matchedPrCode: null,
  })

  it('filters out rows with needToBuyQty=0 (đủ kho)', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', quantity: 100, neededQty: 100, needToBuyQty: 60 },
      { stt: '002', description: 'Thép H', quantity: 50, neededQty: 50, needToBuyQty: 0 },
      { stt: '003', description: 'Tôn tấm', quantity: 30, neededQty: 30, needToBuyQty: 30 },
    ]
    const quotes: SupplierQuote[] = [{
      id: 'q1', vendorName: 'NCC A', totalAmount: 10000000,
      lines: [makeLine(0, 50000, 100), makeLine(1, 80000, 50), makeLine(2, 120000, 30)],
    }]

    const result = computeMatrixTotals(prItems, quotes)
    expect(result.hasBreakdown).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect(result.skippedCount).toBe(1)
    expect(result.rows.map(r => r.prIdx)).toEqual([0, 2])
  })

  it('computes NCC total = Σ(needToBuyQty × unitPrice)', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', quantity: 100, neededQty: 100, needToBuyQty: 60 },
      { stt: '002', description: 'Tôn tấm', quantity: 30, neededQty: 30, needToBuyQty: 20 },
    ]
    const quotes: SupplierQuote[] = [
      {
        id: 'q1', vendorName: 'NCC A', totalAmount: 999999,
        lines: [makeLine(0, 50000, 100), makeLine(1, 120000, 30)],
      },
      {
        id: 'q2', vendorName: 'NCC B', totalAmount: 888888,
        lines: [makeLine(0, 45000, 100), makeLine(1, 130000, 30)],
      },
    ]

    const result = computeMatrixTotals(prItems, quotes)
    // q1: 60*50000 + 20*120000 = 3000000 + 2400000 = 5400000
    expect(result.nccTotals['q1']).toBe(5400000)
    // q2: 60*45000 + 20*130000 = 2700000 + 2600000 = 5300000
    expect(result.nccTotals['q2']).toBe(5300000)
    expect(result.cheapestId).toBe('q2')
    expect(result.cheapestTotal).toBe(5300000)
  })

  it('falls back to full quantity when no breakdown data', () => {
    const prItems: PrItem[] = [
      { stt: '001', description: 'Thép C', quantity: 100 },
      { stt: '002', description: 'Tôn tấm', quantity: 30 },
    ]
    const quotes: SupplierQuote[] = [{
      id: 'q1', vendorName: 'NCC A', totalAmount: 5000000,
      lines: [makeLine(0, 50000, 100), makeLine(1, 100000, 30)],
    }]

    const result = computeMatrixTotals(prItems, quotes)
    expect(result.hasBreakdown).toBe(false)
    expect(result.rows).toHaveLength(2)
    expect(result.skippedCount).toBe(0)
    // full qty: 100*50000 + 30*100000 = 5000000 + 3000000 = 8000000
    expect(result.nccTotals['q1']).toBe(8000000)
  })
})
