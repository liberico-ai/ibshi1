// Đọc bảng TỔNG HỢP dự toán thi công từ file Excel — chịu được nhiều biến thể biểu mẫu.
//
// Vì sao không bắt theo tên sheet: khảo sát 4 file thật thấy 4 kiểu đặt tên khác nhau —
// "DT02 (TH)", "DT02(TH)", "DT02TCKT", và "DT01 (TH)" (dự án nội bộ, tổng hợp nằm ở DT01).
// Bắt theo chuỗi "dt02" như trước sẽ vớ nhầm sheet VẬT TƯ của file thứ tư → đọc ra 0.
//
// Nguyên tắc ở đây:
//   • Chọn sheet bằng NỘI DUNG (chấm điểm), không bằng tên.
//   • Tìm cột giá trị theo NHÃN cột ("Giá trị"/"Thành tiền"), không cứng ở cột D.
//   • Phân loại khoản mục theo CHỮ trong ô nội dung, không theo số La Mã — có file dùng
//     "IV" cho dòng TỔNG chứ không phải chi phí chung.
//   • Thiếu khoản mục là bình thường (dự án nội bộ) → khoản đó = 0, không coi là lỗi.
//
// Thuần, không I/O: nhận vào các sheet đã đọc sẵn (mảng 2 chiều) để test được và để cả
// client lẫn server dùng chung.

export type Cell = string | number | boolean | null | undefined
export type Row = Cell[]
export type SheetMap = Record<string, Row[]>

export interface EstimateTotalsParsed {
  material: number
  labor: number
  service: number
  overhead: number
  grand: number
}

export interface EstimateDetailRow { maCP: string; noiDung: string; giaTri: number }

export interface SheetCandidate { name: string; score: number }

export interface EstimateParseResult {
  ok: boolean
  /** Vì sao không đọc được (chỉ khi ok=false) */
  reason?: 'NO_SHEET' | 'NO_NUMBERS'
  sheetName?: string
  headerRow?: number
  valueColumn?: number
  totals: EstimateTotalsParsed
  detailRows: EstimateDetailRow[]
  /** Cảnh báo KHÔNG chặn: lệch tổng, thiếu khoản mục… */
  warnings: string[]
  /** Mọi sheet kèm điểm — để giao diện cho người dùng tự chọn khi máy đoán sai */
  candidates: SheetCandidate[]
}

// ── Tiện ích ──

/** Bỏ dấu + hạ chữ thường, để so khớp không phụ thuộc cách gõ dấu. */
export function norm(v: Cell): string {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Đổi ô Excel thành số. Chịu được "1.234.567,89", "1,234,567.89", có ký tự tiền tệ.
 * Ô công thức chưa tính (chuỗi bắt đầu bằng "=") → NaN, KHÔNG coi là 0 để phân biệt
 * "file chưa có số" với "số bằng 0".
 */
export function toNumber(v: Cell): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  const raw = String(v ?? '').trim()
  if (!raw || raw.startsWith('=')) return NaN
  let s = raw.replace(/[^\d.,\-]/g, '')
  if (!s) return NaN
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // Dấu nào ở sau là dấu thập phân
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // Chỉ có dấu phẩy: 3 chữ số sau nó → phân cách nghìn, ngược lại là thập phân
    s = /,\d{3}(\D|$)/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  } else {
    s = /\.\d{3}(\D|$)/.test(s) && (s.match(/\./g) || []).length > 1 ? s.replace(/\./g, '') : s
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

// ── Từ khoá nhận diện ──

const KW_TOTAL = ['tong hop chi phi', 'tong chi phi', 'tong cong', 'tong gia tri', 'tong du toan']
const KW_MATERIAL = ['chi phi vat tu', 'vat tu']
const KW_LABOR = ['nhan cong']
const KW_SERVICE = ['dich vu']
const KW_OVERHEAD = ['chi phi chung', 'chi phi tai chinh', 'quan ly']

type Category = 'material' | 'labor' | 'service' | 'overhead' | 'total' | null

/** Dòng này thuộc khoản mục nào — xét chữ, dòng TỔNG được ưu tiên trước. */
export function classifyRow(text: string): Category {
  const t = norm(text)
  if (!t) return null
  if (KW_TOTAL.some(k => t.includes(k))) return 'total'
  if (KW_MATERIAL.some(k => t.includes(k))) return 'material'
  if (KW_LABOR.some(k => t.includes(k))) return 'labor'
  if (KW_SERVICE.some(k => t.includes(k))) return 'service'
  if (KW_OVERHEAD.some(k => t.includes(k))) return 'overhead'
  return null
}

const ROMAN = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi'])

/**
 * Chấm điểm một sheet xem có phải bảng TỔNG HỢP không.
 * Bẫy đã gặp: sheet "DT07 (CPC)" cũng có I/II/III ở cột A nhưng nội dung là chi phí chung /
 * tài chính / quản lý → không có "vật tư" lẫn "nhân công" nên điểm thấp, không bị chọn nhầm.
 */
export function scoreSheet(name: string, rows: Row[]): number {
  let score = 0
  const head = rows.slice(0, 6).map(r => (r || []).map(norm).join(' ')).join(' | ')
  if (head.includes('tong hop')) score += 3
  if (/dt0\d/.test(norm(name)) && /\bth\b|tckt|tong hop/.test(norm(name))) score += 1

  const found = new Set<Category>()
  let romanRows = 0
  for (const row of rows) {
    if (!row) continue
    if (ROMAN.has(norm(row[0]))) romanRows++
    for (const cell of row.slice(0, 4)) {
      const cat = classifyRow(String(cell ?? ''))
      if (cat) found.add(cat)
    }
  }
  for (const c of ['material', 'labor', 'service', 'overhead'] as Category[]) if (found.has(c)) score += 2
  if (found.has('total')) score += 2
  if (romanRows >= 2) score += 1
  return score
}

/** Dòng tiêu đề bảng (có "Nội dung chi phí", hoặc STT + Giá trị/Thành tiền). */
function findHeaderRow(rows: Row[]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(norm)
    if (cells.some(c => c.includes('noi dung chi phi') || c.includes('noi dung'))) return i
    if (cells.some(c => c === 'stt') && cells.some(c => c.includes('gia tri') || c.includes('thanh tien'))) return i
  }
  return -1
}

/** Cột chứa số tiền: theo nhãn trước, không có nhãn thì lấy cột số "dày" nhất bên phải. */
function findValueColumn(rows: Row[], headerRow: number): number {
  if (headerRow >= 0) {
    const cells = (rows[headerRow] || []).map(norm)
    const byLabel = cells.findIndex(c => c.includes('gia tri') || c.includes('thanh tien'))
    if (byLabel >= 0) return byLabel
  }
  const counts: number[] = []
  for (const row of rows) {
    if (!row) continue
    row.forEach((c, i) => { if (Number.isFinite(toNumber(c))) counts[i] = (counts[i] || 0) + 1 })
  }
  let best = -1, bestCount = 0
  counts.forEach((n, i) => { if (n >= bestCount && n > 0) { best = i; bestCount = n } })
  return best
}

/** Cột chứa mô tả khoản mục. */
function findContentColumn(rows: Row[], headerRow: number): number {
  if (headerRow >= 0) {
    const cells = (rows[headerRow] || []).map(norm)
    const idx = cells.findIndex(c => c.includes('noi dung') || c.includes('danh muc'))
    if (idx >= 0) return idx
  }
  return 2
}

/**
 * Đọc dự toán từ các sheet đã nạp.
 * @param sheets  { [tên sheet]: mảng dòng (mảng ô) }
 * @param opts.sheetName  ép đọc đúng sheet này (khi người dùng tự chọn)
 */
export function parseEstimateSheets(sheets: SheetMap, opts?: { sheetName?: string }): EstimateParseResult {
  const empty: EstimateTotalsParsed = { material: 0, labor: 0, service: 0, overhead: 0, grand: 0 }
  const candidates: SheetCandidate[] = Object.entries(sheets)
    .map(([name, rows]) => ({ name, score: scoreSheet(name, rows || []) }))
    .sort((a, b) => b.score - a.score)

  const picked = opts?.sheetName && sheets[opts.sheetName]
    ? { name: opts.sheetName, score: candidates.find(c => c.name === opts.sheetName)?.score ?? 0 }
    : candidates[0]

  // Điểm quá thấp = không sheet nào giống bảng tổng hợp → để người dùng tự chọn
  if (!picked || (!opts?.sheetName && picked.score < 4)) {
    return { ok: false, reason: 'NO_SHEET', totals: empty, detailRows: [], warnings: [], candidates }
  }

  const rows = sheets[picked.name] || []
  const headerRow = findHeaderRow(rows)
  const valueColumn = findValueColumn(rows, headerRow)
  const contentColumn = findContentColumn(rows, headerRow)

  const totals: EstimateTotalsParsed = { ...empty }
  const detailRows: EstimateDetailRow[] = []
  const warnings: string[] = []
  let explicitGrand = NaN
  let sawAnyNumber = false

  for (let i = 0; i < rows.length; i++) {
    if (headerRow >= 0 && i <= headerRow) continue
    const row = rows[i]
    if (!row) continue

    const value = toNumber(row[valueColumn])
    const stt = String(row[0] ?? '').trim()
    const text = String(row[contentColumn] ?? '').trim()
    if (Number.isFinite(value)) sawAnyNumber = true

    const cat = classifyRow(text)
    const isSection = ROMAN.has(norm(stt)) || cat !== null

    if (cat === 'total') {
      if (Number.isFinite(value)) explicitGrand = value
      detailRows.push({ maCP: stt || 'TỔNG', noiDung: text, giaTri: Number.isFinite(value) ? value : 0 })
      continue
    }
    if (isSection && cat && Number.isFinite(value)) {
      // Chỉ lấy dòng đầu tiên của mỗi khoản (dòng con bên dưới đã nằm trong đó)
      if (totals[cat] === 0) totals[cat] = value
      detailRows.push({ maCP: stt || '', noiDung: text, giaTri: value })
      continue
    }
    // Dòng chi tiết: có mã CP hoặc STT số, có giá trị
    const maCP = String(row[1] ?? '').trim()
    if ((maCP || /^\d+$/.test(stt)) && Number.isFinite(value) && value > 0) {
      detailRows.push({ maCP: maCP || stt, noiDung: text, giaTri: value })
    }
  }

  const sum = totals.material + totals.labor + totals.service + totals.overhead
  totals.grand = Number.isFinite(explicitGrand) && explicitGrand > 0 ? explicitGrand : sum

  if (!(totals.grand > 0)) {
    return {
      ok: false,
      reason: sawAnyNumber ? 'NO_NUMBERS' : 'NO_NUMBERS',
      sheetName: picked.name, headerRow, valueColumn,
      totals: empty, detailRows: [], warnings, candidates,
    }
  }

  // Cảnh báo — KHÔNG chặn
  if (Number.isFinite(explicitGrand) && explicitGrand > 0 && sum > 0) {
    const diff = Math.abs(explicitGrand - sum)
    if (diff / explicitGrand > 0.01) {
      warnings.push(`Dòng tổng trong file (${Math.round(explicitGrand).toLocaleString('vi-VN')}) lệch với tổng 4 khoản (${Math.round(sum).toLocaleString('vi-VN')}). Đang lấy theo dòng tổng của file.`)
    }
  }
  const missing = ([['material', 'vật tư'], ['labor', 'nhân công'], ['service', 'dịch vụ'], ['overhead', 'chi phí chung']] as const)
    .filter(([k]) => totals[k] === 0).map(([, label]) => label)
  if (missing.length) warnings.push(`Không thấy khoản: ${missing.join(', ')} — để 0. Bình thường với dự án nội bộ.`)

  return { ok: true, sheetName: picked.name, headerRow, valueColumn, totals, detailRows, warnings, candidates }
}
