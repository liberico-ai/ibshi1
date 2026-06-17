import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parsePrRows } from '../pr-parser'

function makeSheet(rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'PR')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('parsePrRows', () => {
  it('reads Total Ordered column when present (complex PR)', () => {
    const buf = makeSheet([
      ['', '', '', 'IBS HI JOINT STOCK COMPANY'],
      ['', '', '', 'PURCHASE REQUISITION'],
      ['Department/ Phòng: ENGINEERING', '', '', 'Project Code/ Mã dự án: 2024-095'],
      ['Item/\nSTT', 'Description/\nChi tiết', 'Profile/ Vật tư', 'Grade/ Mác', 'Mã vật tư', 'Unit/ Đơn vị', 'U.Weight', 'Net Quantity/\nSố lượng tinh', '', 'Previous Ordered/\nĐã dự trù', '', 'Current Ordered/\nDự trù lần 1', '', 'Total Ordered/\nTổng dự trù', ''],
      ['', '', '', '', '', '', '', 'Q.Ty', 'Weight', 'Q.Ty', 'Weight', 'Q.Ty', 'Weight', 'Q.Ty', 'Weight'],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ['VTC01', 'Main-Material / Vật tư chính'],
      ['I95-VTC01-001', 'Tôn tấm', 'PL10x2000X12000', 'SS400', 'VLC-PL10x2000x12000-SS400', 'm2', 78.5, 459.42560660402535, 36000, 513, 40271, 48, 3768, 513, 40271],
    ])
    const rows = parsePrRows(buf)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const row = rows.find(r => r.code.includes('VLC-PL10'))
    expect(row).toBeDefined()
    expect(row!.qty).toBe('513')
    expect(row!.spec).toContain('PL10x2000X12000')
  })

  it('falls back to Net Quantity for simple PR (no Total Ordered)', () => {
    const buf = makeSheet([
      ['Item', 'Description', 'Profile', 'Grade', 'Mã vật tư', 'Unit', 'Net Quantity'],
      ['001', 'Tấm thép', 'PL6x1500x6000', 'SS400', 'VLC-PL6-SS400', 'm2', 123.456],
    ])
    const rows = parsePrRows(buf)
    expect(rows.length).toBe(1)
    expect(rows[0].qty).toBe('123.456')
    expect(rows[0].code).toBe('VLC-PL6-SS400')
  })

  it('preserves raw numeric precision (not formatted/rounded)', () => {
    const buf = makeSheet([
      ['Item', 'Description', 'Mã vật tư', 'Unit', 'Total Ordered/\nTổng dự trù', ''],
      ['', '', '', '', 'Q.Ty', 'Weight'],
      ['001', 'Ống thép', 'VLO-D48-SS400', 'Cái', 1664.2707453350317, 326613.133772],
    ])
    const rows = parsePrRows(buf)
    expect(rows.length).toBe(1)
    expect(rows[0].qty).toBe('1664.2707453350317')
  })

  it('skips noise rows (company info, category headers, footer)', () => {
    const buf = makeSheet([
      ['', '', '', 'IBS HI JOINT STOCK COMPANY'],
      ['Department/ Phòng', '', '', 'Project Code/ Mã dự án: X'],
      ['Item/ STT', 'Description/ Chi tiết', 'Profile', 'Grade', 'Mã vật tư', 'Unit/ Đơn vị', 'Net Quantity'],
      [1, 2, 3, 4, 5, 6, 7],
      ['VTC01', 'Main-Material / Vật tư chính'],
      ['I95-VTC01-001', 'Tôn tấm', 'PL10', 'SS400', 'VLC-PL10', 'm2', 100],
      ['Priority', 'Remarks section'],
    ])
    const rows = parsePrRows(buf)
    expect(rows.length).toBe(1)
    expect(rows[0].code).toBe('VLC-PL10')
  })

  it('handles rows with zero qty gracefully', () => {
    const buf = makeSheet([
      ['Item', 'Description', 'Mã vật tư', 'Unit', 'Net Quantity'],
      ['001', 'Tấm thép', 'VLC-PL6', 'm2', 0],
      ['002', 'Ống thép', 'VLO-D48', 'Cái', 50],
    ])
    const rows = parsePrRows(buf)
    expect(rows.length).toBe(2)
    expect(rows[0].qty).toBe('0')
    expect(rows[1].qty).toBe('50')
  })
})
