// Parser WBS — nhận Form BCTH-IBSHI-QLDA-01 (header 3 tầng gộp ô, 16 công đoạn gia công)
// VÀ tương thích form cũ (1 dòng header, 9 cột phẳng). Trả về WbsRow[].
import type { WbsRow } from './types/cross-step-data'

const norm = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

// Nhận diện công đoạn từ nhãn (cụm DÀI khớp trước để tránh "sơn" nuốt "sơn liner"…).
const STAGE_PATTERNS: [string, string][] = [
  ['sơn liner', 'linerPainting'], ['liner painting', 'linerPainting'],
  ['chế tạo khung kiện', 'khungKien'], ['shipping frame', 'khungKien'],
  ['tổ hợp thử', 'tryAssembly'], ['try-assembly', 'tryAssembly'], ['try assembly', 'tryAssembly'],
  ['chạy thử', 'commissioning'], ['commissioning', 'commissioning'],
  ['bảo ôn', 'insulation'], ['insulation', 'insulation'],
  ['làm sạch', 'blasting'], ['blasting', 'blasting'], ['rửa axit', 'blasting'],
  ['tháo dỡ', 'dismantle'], ['dismantle', 'dismantle'],
  ['sửa hàng sau mạ', 'repairAfterGalv'], ['repair after', 'repairAfterGalv'],
  ['lắp giao hàng', 'shippingAssembly'], ['shipping assembly', 'shippingAssembly'],
  ['đóng kiện', 'packing'], ['packing', 'packing'],
  ['giao hàng', 'delivery'], ['delivery', 'delivery'],
  ['gcck', 'machining'], ['machining', 'machining'],
  ['cắt', 'cutting'], ['cutting', 'cutting'],
  ['gá', 'fitup'], ['fitup', 'fitup'], ['fit up', 'fitup'],
  ['hàn', 'welding'], ['welding', 'welding'],
  ['mạ', 'galvanize'], ['galvanize', 'galvanize'],
  ['sơn', 'painting'], ['painting', 'painting'],
]
function stageOf(label: string): string | null {
  const n = norm(label)
  for (const [pat, key] of STAGE_PATTERNS) if (n.includes(pat)) return key
  return null
}

// Nhãn cột cơ bản → key
const BASE_MAP: Record<string, string> = {
  'stt': 'stt', 'no': 'stt', 'no.': 'stt',
  'hạng mục': 'hangMuc', 'item': 'hangMuc', 'mô tả': 'hangMuc', 'description': 'hangMuc',
  'đvt': 'dvt', 'unit': 'dvt',
  'khối lượng': 'khoiLuong', 'kl': 'khoiLuong', 'qty': 'khoiLuong', 'volume': 'khoiLuong',
  'diện tích': 'dienTich',
  'bảo ôn': 'baoOn',
  'phạm vi': 'phamVi', 'scope': 'phamVi', 'ibs hi': 'phamVi', 'ibshi': 'phamVi',
  'sub-contractor': 'thauPhu', 'thầu phụ': 'thauPhu', 'sub contractor': 'thauPhu',
  'tổng nhân lực': 'tongNhanLuc',
  'bắt đầu': 'batDau', 'start': 'batDau',
  'kết thúc': 'ketThuc', 'finish': 'ketThuc', 'end': 'ketThuc',
  'khu vực': 'khuVuc', 'area': 'khuVuc', 'khu vực thi công': 'khuVuc',
  'ghi chú': 'ghiChu', 'note': 'ghiChu', 'remark': 'ghiChu',
}
function baseKeyOf(label: string): string {
  const n = norm(label)
  if (BASE_MAP[n]) return BASE_MAP[n]
  // khớp chứa (nhãn dài như "tên công trình, hạng mục…")
  for (const [k, v] of Object.entries(BASE_MAP)) if (n.includes(k)) return v
  return ''
}

// Chuẩn hoá ngày về yyyy-mm-dd. Nhận: SERIAL Excel (số ~40000-60000), ISO, dd/mm hoặc mm/dd (tự nhận).
function toISODate(v: string): string {
  const s = String(v).trim()
  if (!s) return ''
  // Excel serial date (số nguyên) — nguồn tin cậy nhất, không nhập nhằng
  if (/^\d{4,6}$/.test(s)) {
    const n = Number(s)
    if (n >= 20000 && n <= 90000) {
      const d = new Date(Math.round((n - 25569) * 86400000))
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    }
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) {
    let [, a, b, y] = m; if (y.length === 2) y = '20' + y
    // tự nhận dd/mm vs mm/dd: số >12 chắc chắn là NGÀY
    let day = a, mo = b
    if (Number(b) > 12 && Number(a) <= 12) { day = b; mo = a } // mm/dd
    return `${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return s
}

const leaf = (s: string) => { const n = norm(s); if (/đơn vị|unit/.test(n)) return 'unit'; if (/bắt đầu|start/.test(n)) return 'start'; if (/kết thúc|finish|end/.test(n)) return 'finish'; return '' }

/**
 * Cắt bỏ phần GHI CHÚ / chú giải / hướng dẫn / khối chữ ký khỏi mảng WbsRow.
 * Dùng cho dữ liệu ĐÃ LƯU (có thể import trước khi parser lọc ghi chú). Từ dòng "Ghi chú/Note/Quy định"
 * trở đi đều bị loại; bỏ thêm dòng gạch đầu dòng. An toàn với rowIndex nếu áp NHẤT QUÁN mọi nơi.
 */
export function stripWbsNotes(rows: WbsRow[]): WbsRow[] {
  if (!Array.isArray(rows)) return []
  const noteAt = rows.findIndex(r => /^(ghi chú|note|chú thích|remark|lưu ý|quy định)/i.test(String(r?.hangMuc || '').trim()))
  const cut = noteAt >= 0 ? rows.slice(0, noteAt) : rows
  return cut.filter(r => !/^[-*•–—]\s/.test(String(r?.hangMuc || '').trim()))
}

// forward-fill 1 dòng header: ô rỗng nhận giá trị ô KHÔNG rỗng gần nhất bên trái (tái tạo ô gộp).
const ffill = (row: string[]): string[] => { const out: string[] = []; let last = ''; for (let c = 0; c < row.length; c++) { const v = String(row[c] ?? '').trim(); if (v) last = v; out[c] = v || last } return out }

/**
 * parseWbsExcel: nhận mảng dòng (sheet_to_json header:1). Tự tìm header, hỗ trợ 1 hoặc nhiều tầng.
 */
export function parseWbsExcel(rows: unknown[][]): WbsRow[] {
  const grid = rows.map(r => (r || []).map(c => String(c ?? '')))
  if (grid.length === 0) return []

  // 1. Tìm dòng anchor chứa "STT" (dạng token — nhận cả "STT/ No.")
  let anchor = -1, sttCol = -1
  for (let r = 0; r < Math.min(20, grid.length); r++) {
    const idx = grid[r].findIndex(c => /(^|[^a-z])stt([^a-z]|$)/.test(norm(c)))
    if (idx >= 0) { anchor = r; sttCol = idx; break }
  }
  if (anchor < 0) return []

  // 2. Xác định dòng dữ liệu bắt đầu = dòng đầu tiên sau anchor có STT là SỐ
  let dataStart = anchor + 1
  for (let r = anchor + 1; r < grid.length; r++) {
    if (/^\d+([.,]\d+)?$/.test(norm(grid[r][sttCol]))) { dataStart = r; break }
  }
  const headerRows = grid.slice(anchor, dataStart).map(ffill)
  const ncol = Math.max(...headerRows.map(r => r.length), 0)

  // 3. Map từng cột → key
  const colKey: string[] = []
  for (let c = 0; c < ncol; c++) {
    const tiers = headerRows.map(hr => hr[c] || '')
    // tầng "tên công đoạn" = tầng áp chót (ngay trên leaf) khi có ≥3 tầng; nếu 2 tầng thì tầng trên
    const stageTier = headerRows.length >= 3 ? tiers[tiers.length - 2] : (headerRows.length === 2 ? tiers[0] : '')
    const leafTier = tiers[tiers.length - 1]
    const st = stageOf(stageTier)
    const lf = leaf(leafTier)
    if (st && lf) {
      colKey[c] = lf === 'unit' ? st : `${st}${lf === 'start' ? 'Start' : 'Finish'}`
    } else {
      // cột cơ bản: ghép mọi tầng rồi khớp (ưu tiên tầng cụ thể nhất)
      colKey[c] = baseKeyOf([...tiers].reverse().join(' ')) || baseKeyOf(tiers.join(' '))
    }
  }

  // 4. Parse dữ liệu
  const DATE_KEYS = new Set(['batDau', 'ketThuc'])
  const isDateKey = (k: string) => DATE_KEYS.has(k) || /Start$|Finish$/.test(k)
  const out: WbsRow[] = []
  for (let r = dataStart; r < grid.length; r++) {
    const rowArr = grid[r]
    if (!rowArr || rowArr.every(c => !String(c).trim())) continue
    const row: WbsRow = { stt: '', hangMuc: '', dvt: 'kg', khoiLuong: '', phamVi: 'IBS', thauPhu: '', batDau: '', ketThuc: '', khuVuc: '', ghiChu: '' }
    for (let c = 0; c < ncol; c++) {
      const k = colKey[c]; if (!k) continue
      let val = String(rowArr[c] ?? '').trim(); if (!val) continue
      if (isDateKey(k)) val = toISODate(val)
      row[k] = val
    }
    // Bỏ dòng "đánh số cột" của template (1,2,3…) — hạng mục thật là chữ, không phải số nguyên thuần.
    const hm = String(row.hangMuc).trim()
    if (/^\d+$/.test(hm)) continue
    // Hết bảng WBS: từ dòng "Ghi chú/ Note" trở đi là chú giải + hướng dẫn + khối chữ ký → DỪNG đọc.
    if (/^(ghi chú|note|chú thích|remark|lưu ý|quy định)/i.test(hm)) break
    // Phòng hờ: bỏ dòng gạch đầu dòng ghi chú lọt giữa bảng.
    if (/^[-*•–—]\s/.test(hm)) continue
    if (hm || String(row.stt).trim()) out.push(row)
  }
  return out
}
