// Helper xuất log (Nhật ký / Error Logs) ra Excel.
// - Kiểm khoảng thời gian (bắt buộc, span tối đa 3 tháng).
// - Dựng workbook: nếu lọc 1 phòng + 1 giá trị nhóm → 1 sheet phẳng;
//   nếu "Tất cả" → mỗi phòng ban 1 sheet (xếp theo cột nhóm) + sheet "Tổng hợp" đếm phòng × nhóm.
import * as XLSX from 'xlsx'
import { DEPARTMENTS_V2, DEPT_NAME } from './org-map'

// ~3 tháng. Cho phép nhỉnh hơn 90 ngày một chút để không chặn nhầm mốc tháng dài.
export const EXPORT_MAX_SPAN_MS = 93 * 24 * 60 * 60 * 1000
export const EXPORT_MAX_ROWS = 100_000

/** Mã "phòng" cho bản ghi không xác định được phòng (user null / role lạ). */
export const DEPT_UNKNOWN = 'KHAC'

export interface ExportRange {
  from: Date
  to: Date
}

/** Đọc & kiểm from/to từ query. Trả { error } nếu không hợp lệ. */
export function parseLogExportRange(url: URL): { range: ExportRange } | { error: string } {
  const fromStr = url.searchParams.get('from') || ''
  const toStr = url.searchParams.get('to') || ''
  if (!fromStr || !toStr) return { error: 'Thiếu khoảng thời gian (from, to)' }

  const from = new Date(fromStr)
  const to = new Date(toStr + 'T23:59:59.999Z')
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return { error: 'Ngày không hợp lệ' }
  if (from.getTime() > to.getTime()) return { error: 'Ngày bắt đầu phải trước ngày kết thúc' }
  if (to.getTime() - from.getTime() > EXPORT_MAX_SPAN_MS) return { error: 'Khoảng thời gian tối đa 3 tháng' }

  return { range: { from, to } }
}

/** Nhãn phòng ban hiển thị. */
export function deptLabel(deptCode: string): string {
  if (deptCode === DEPT_UNKNOWN) return 'Khác'
  return DEPT_NAME[deptCode] || deptCode
}

/** Excel không cho một số ký tự trong tên sheet và giới hạn 31 ký tự. */
function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let candidate = base
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`
    base = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31 - suffix.length)
    candidate = base + suffix
    n++
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export interface ExportRow {
  dept: string                            // mã phòng hoặc DEPT_UNKNOWN
  group: string                           // giá trị cột nhóm (action / level)
  person?: string                         // nhân sự "MãNV-Tên" — có thì sheet Tổng hợp tách theo người
  values: Record<string, string | number> // giá trị theo từng header
}

/**
 * Dựng file .xlsx. `flat=true` → 1 sheet phẳng (đã lọc 1 phòng + 1 nhóm).
 * Ngược lại → sheet "Tổng hợp" + mỗi phòng 1 sheet.
 * Rows giả định đã sắp theo thời gian giảm dần; trong sheet phòng sẽ xếp lại theo cột nhóm.
 */
export function buildLogWorkbookBuffer(opts: {
  headers: string[]
  rows: ExportRow[]
  flat: boolean
  groupColLabel: string // nhãn cột nhóm trong sheet Tổng hợp (vd "Hành động", "Mức")
}): Buffer {
  const { headers, rows, flat, groupColLabel } = opts
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  const toAoa = (rs: ExportRow[]): (string | number)[][] => [
    headers,
    ...rs.map(r => headers.map(h => r.values[h] ?? '')),
  ]

  if (flat) {
    const ws = XLSX.utils.aoa_to_sheet(toAoa(rows))
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('Nhật ký', used))
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }

  // Gom theo phòng
  const byDept = new Map<string, ExportRow[]>()
  for (const r of rows) {
    const arr = byDept.get(r.dept)
    if (arr) arr.push(r)
    else byDept.set(r.dept, [r])
  }
  const deptOrder = [...DEPARTMENTS_V2.map(d => d.code), DEPT_UNKNOWN]
  const presentDepts = deptOrder.filter(d => byDept.has(d))

  // Sheet Tổng hợp (đầu tiên). Nếu rows có 'person' → tách thêm cột Nhân sự (dept → nhân sự → nhóm).
  const hasPerson = rows.some(r => r.person)
  const summary: (string | number)[][] = [
    hasPerson ? ['Phòng ban', 'Nhân sự', groupColLabel, 'Số bản ghi'] : ['Phòng ban', groupColLabel, 'Số bản ghi'],
  ]
  for (const dept of presentDepts) {
    const deptRows = byDept.get(dept)!
    if (hasPerson) {
      const byPerson = new Map<string, ExportRow[]>()
      for (const r of deptRows) {
        const p = r.person || '(không rõ)'
        const arr = byPerson.get(p)
        if (arr) arr.push(r)
        else byPerson.set(p, [r])
      }
      for (const person of [...byPerson.keys()].sort()) {
        const personRows = byPerson.get(person)!
        const countByGroup = new Map<string, number>()
        for (const r of personRows) countByGroup.set(r.group, (countByGroup.get(r.group) || 0) + 1)
        for (const g of [...countByGroup.keys()].sort()) {
          summary.push([deptLabel(dept), person, g, countByGroup.get(g)!])
        }
      }
      summary.push([`${deptLabel(dept)} — Tổng`, '', '', deptRows.length])
    } else {
      const countByGroup = new Map<string, number>()
      for (const r of deptRows) countByGroup.set(r.group, (countByGroup.get(r.group) || 0) + 1)
      for (const g of [...countByGroup.keys()].sort()) {
        summary.push([deptLabel(dept), g, countByGroup.get(g)!])
      }
      summary.push([`${deptLabel(dept)} — Tổng`, '', deptRows.length])
    }
  }
  summary.push(hasPerson ? ['TỔNG CỘNG', '', '', rows.length] : ['TỔNG CỘNG', '', rows.length])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), safeSheetName('Tổng hợp', used))

  // Mỗi phòng 1 sheet, trong sheet xếp theo cột nhóm (rồi giữ thứ tự thời gian)
  for (const dept of presentDepts) {
    const deptRows = byDept.get(dept)!.slice().sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0))
    const ws = XLSX.utils.aoa_to_sheet(toAoa(deptRows))
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(deptLabel(dept), used))
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
