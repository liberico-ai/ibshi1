import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseLogExportRange, buildLogWorkbookBuffer, DEPT_UNKNOWN, type ExportRow,
} from '../log-export'

function urlWith(params: Record<string, string>): URL {
  const u = new URL('https://x.test/api')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u
}

const HEADERS = ['Thời gian', 'Hành động', 'Phòng ban']

function row(dept: string, group: string, time = '2026-07-01'): ExportRow {
  return { dept, group, values: { 'Thời gian': time, 'Hành động': group, 'Phòng ban': dept } }
}

describe('parseLogExportRange', () => {
  it('thiếu from/to → lỗi', () => {
    expect('error' in parseLogExportRange(urlWith({}))).toBe(true)
    expect('error' in parseLogExportRange(urlWith({ from: '2026-07-01' }))).toBe(true)
  })

  it('from > to → lỗi', () => {
    const r = parseLogExportRange(urlWith({ from: '2026-07-10', to: '2026-07-01' }))
    expect('error' in r).toBe(true)
  })

  it('span > 3 tháng → lỗi', () => {
    const r = parseLogExportRange(urlWith({ from: '2026-01-01', to: '2026-06-01' }))
    expect('error' in r).toBe(true)
  })

  it('hợp lệ → trả range with inclusive end-of-day', () => {
    const r = parseLogExportRange(urlWith({ from: '2026-07-01', to: '2026-07-31' }))
    expect('range' in r).toBe(true)
    if ('range' in r) {
      expect(r.range.from.getTime()).toBeLessThan(r.range.to.getTime())
      // to = cuối ngày
      expect(r.range.to.toISOString()).toContain('23:59:59')
    }
  })
})

describe('buildLogWorkbookBuffer', () => {
  it('flat → đúng 1 sheet với header + rows', () => {
    const buf = buildLogWorkbookBuffer({
      headers: HEADERS,
      rows: [row('SX', 'LOGIN'), row('SX', 'LOGIN')],
      flat: true,
      groupColLabel: 'Hành động',
    })
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames.length).toBe(1)
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }) as unknown[][]
    expect(aoa[0]).toEqual(HEADERS)
    expect(aoa.length).toBe(3) // header + 2 rows
  })

  it('grouped + person → sheet Tổng hợp có cột Nhân sự, tách theo người', () => {
    const rp = (dept: string, group: string, person: string): ExportRow =>
      ({ dept, group, person, values: { 'Thời gian': '', 'Hành động': group, 'Phòng ban': dept } })
    const buf = buildLogWorkbookBuffer({
      headers: HEADERS,
      rows: [rp('SX', 'LOGIN', 'NV01-An'), rp('SX', 'LOGIN', 'NV01-An'), rp('SX', 'CREATE', 'NV02-Binh')],
      flat: false,
      groupColLabel: 'Hành động',
    })
    const wb = XLSX.read(buf, { type: 'buffer' })
    const summary = XLSX.utils.sheet_to_json(wb.Sheets['Tổng hợp'], { header: 1 }) as unknown[][]
    expect(summary[0]).toEqual(['Phòng ban', 'Nhân sự', 'Hành động', 'Số bản ghi'])
    const r = summary.find(x => x[1] === 'NV01-An' && x[2] === 'LOGIN')
    expect(r?.[3]).toBe(2)
    const totalRow = summary.find(x => x[0] === 'TỔNG CỘNG')
    expect(totalRow?.[3]).toBe(3)
  })

  it('grouped → sheet Tổng hợp đầu tiên + mỗi phòng 1 sheet', () => {
    const buf = buildLogWorkbookBuffer({
      headers: HEADERS,
      rows: [
        row('SX', 'LOGIN'), row('SX', 'CREATE'),
        row('QC', 'LOGIN'),
        row(DEPT_UNKNOWN, 'LOGIN'),
      ],
      flat: false,
      groupColLabel: 'Hành động',
    })
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames[0]).toBe('Tổng hợp')
    // Sản xuất trước QA/QC (theo thứ tự DEPARTMENTS_V2), Khác cuối
    expect(wb.SheetNames).toContain('Sản xuất')
    expect(wb.SheetNames).toContain('QA/QC'.replace('/', ' ')) // '/' bị thay bằng space trong tên sheet
    expect(wb.SheetNames).toContain('Khác')

    // Tổng hợp có dòng TỔNG CỘNG = 4
    const summary = XLSX.utils.sheet_to_json(wb.Sheets['Tổng hợp'], { header: 1 }) as unknown[][]
    const totalRow = summary.find(r => r[0] === 'TỔNG CỘNG')
    expect(totalRow?.[2]).toBe(4)
  })
})
