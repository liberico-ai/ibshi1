// Parser bảng kê kế toán xuất từ MISA (Bảng tổng hợp/chi tiết phát sinh có cột "Vụ việc").
// Tự dò dòng header (chứa "Tài khoản" + "Phát sinh"), khớp cột theo tên → mảng bút toán.

export interface LedgerRow {
  entryDate: string      // yyyy-mm-dd
  docType: string | null
  docNo: string | null
  partnerCode: string | null
  partnerName: string | null
  description: string | null
  account: string        // TK (bắt buộc)
  contraAccount: string | null
  debit: number
  credit: number
  vuViec: string | null
}

export interface ParseResult {
  ok: boolean
  error?: string
  headerRowIndex?: number
  rows: LedgerRow[]
  totalDebit: number
  totalCredit: number
}

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

// Số tiền: "165,480,400" | "-19049418" | "(2,075.10)" (ngoặc = âm) | "" → 0
export function parseAmount(v: unknown): number {
  let s = String(v ?? '').trim()
  if (!s || s === '-') return 0
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '')
  const n = Number(s)
  if (!Number.isFinite(n)) return 0
  return neg ? -Math.abs(n) : n
}

// Ngày: "31/10/2025" | "2025-10-31" | serial Excel → yyyy-mm-dd ('' nếu không nhận ra)
export function parseDate(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (m) {
    const a = m[1], b = m[2]
    const y = m[3].length === 2 ? '20' + m[3] : m[3]
    let day = a, mo = b
    if (Number(b) > 12 && Number(a) <= 12) { day = b; mo = a } // mm/dd
    return `${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  if (/^\d{4,6}$/.test(s)) { const n = Number(s); if (n >= 20000 && n <= 90000) { const d = new Date(Math.round((n - 25569) * 86400000)); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10) } }
  return ''
}

// Khớp 1 cột theo danh sách mẫu tên (chọn cột KHỚP ĐẦU TIÊN, ưu tiên mẫu cụ thể trước).
function findCol(header: string[], patterns: string[]): number {
  for (const p of patterns) {
    const idx = header.findIndex(h => norm(h).includes(p))
    if (idx >= 0) return idx
  }
  return -1
}

/**
 * parseMisaLedger: nhận grid (sheet_to_json header:1). Trả về các dòng bút toán.
 * Bắt buộc có cột "Tài khoản" + ít nhất 1 cột phát sinh (nợ/có) + cột "Vụ việc".
 */
export function parseMisaLedger(grid: unknown[][]): ParseResult {
  const rows2d = (grid || []).map(r => (r || []).map(c => String(c ?? '')))
  // 1) Dò header: dòng có "tài khoản" và ("phát sinh" hoặc "nợ"/"có") trong 25 dòng đầu
  let hIdx = -1
  for (let r = 0; r < Math.min(30, rows2d.length); r++) {
    const line = rows2d[r].map(norm)
    const hasTk = line.some(c => c === 'tài khoản' || c === 'tk' || c.includes('tài khoản'))
    const hasPs = line.some(c => c.includes('phát sinh') || c === 'nợ' || c === 'có' || c.includes(' psn') || c.includes('psc'))
    if (hasTk && hasPs) { hIdx = r; break }
  }
  if (hIdx < 0) return { ok: false, error: 'Không tìm thấy dòng tiêu đề (cần có cột "Tài khoản" và "Phát sinh Nợ/Có").', rows: [], totalDebit: 0, totalCredit: 0 }

  const header = rows2d[hIdx]
  const col = {
    date: findCol(header, ['ngày ct', 'ngày hạch toán', 'ngày ghi sổ', 'ngày']),
    docType: findCol(header, ['mã ct', 'loại ct', 'mã chứng từ']),
    docNo: findCol(header, ['số ct', 'số chứng từ', 'số hiệu']),
    partnerCode: findCol(header, ['mã khách', 'mã đối tượng', 'mã kh']),
    partnerName: findCol(header, ['tên khách', 'tên đối tượng', 'diễn giải đối tượng']),
    desc: findCol(header, ['diễn giải', 'nội dung']),
    account: findCol(header, ['tài khoản', 'tk']),
    contra: findCol(header, ['tk đối ứng', 'đối ứng', 'tài khoản đối ứng']),
    debit: findCol(header, ['phát sinh nợ', 'ps nợ', 'psn', 'nợ']),
    credit: findCol(header, ['phát sinh có', 'ps có', 'psc', 'có']),
    vuViec: findCol(header, ['vụ việc', 'công trình', 'đối tượng thcp', 'khoản mục']),
  }
  if (col.account < 0) return { ok: false, error: 'Thiếu cột "Tài khoản".', rows: [], totalDebit: 0, totalCredit: 0 }
  if (col.debit < 0 && col.credit < 0) return { ok: false, error: 'Thiếu cột "Phát sinh Nợ/Có".', rows: [], totalDebit: 0, totalCredit: 0 }
  if (col.vuViec < 0) return { ok: false, error: 'Thiếu cột "Vụ việc" — không quy chiếu được về dự án.', rows: [], totalDebit: 0, totalCredit: 0 }

  const at = (arr: string[], i: number) => (i >= 0 ? String(arr[i] ?? '').trim() : '')
  const S = (v: string) => (v ? v : null)
  const out: LedgerRow[] = []
  let totalDebit = 0, totalCredit = 0
  for (let r = hIdx + 1; r < rows2d.length; r++) {
    const a = rows2d[r]
    if (!a || a.every(c => !String(c).trim())) continue
    const account = at(a, col.account).replace(/\s+/g, '')
    // chỉ nhận dòng có SỐ HIỆU tài khoản (vd 6211, 1521) — bỏ dòng tiêu đề nhóm/tổng
    if (!/^\d{3,}/.test(account)) continue
    const debit = parseAmount(at(a, col.debit))
    const credit = parseAmount(at(a, col.credit))
    if (debit === 0 && credit === 0) continue
    const entryDate = parseDate(at(a, col.date))
    out.push({
      entryDate: entryDate || '',
      docType: S(at(a, col.docType)), docNo: S(at(a, col.docNo)),
      partnerCode: S(at(a, col.partnerCode)), partnerName: S(at(a, col.partnerName)),
      description: S(at(a, col.desc)), account,
      contraAccount: S(at(a, col.contra).replace(/\s+/g, '')),
      debit, credit, vuViec: S(at(a, col.vuViec)),
    })
    totalDebit += debit; totalCredit += credit
  }
  if (out.length === 0) return { ok: false, error: 'Không đọc được dòng bút toán nào có tài khoản + phát sinh.', rows: [], totalDebit: 0, totalCredit: 0 }
  return { ok: true, headerRowIndex: hIdx, rows: out, totalDebit, totalCredit }
}

// Nhóm chi phí/khoản mục theo đầu số tài khoản (phục vụ báo cáo chi phí dự án).
export function accountGroup(account: string): { code: string; label: string } {
  const a = String(account || '')
  if (a.startsWith('621')) return { code: 'VT', label: 'Chi phí vật tư (621)' }
  if (a.startsWith('622')) return { code: 'NC', label: 'Chi phí nhân công (622)' }
  if (a.startsWith('623')) return { code: 'MTC', label: 'Chi phí máy thi công (623)' }
  if (a.startsWith('627')) return { code: 'SXC', label: 'Chi phí SX chung (627)' }
  if (a.startsWith('154')) return { code: 'DD', label: 'CP SXKD dở dang (154)' }
  if (a.startsWith('632')) return { code: 'GV', label: 'Giá vốn (632)' }
  if (a.startsWith('641') || a.startsWith('6421')) return { code: 'BH', label: 'Chi phí bán hàng (641)' }
  if (a.startsWith('642')) return { code: 'QLDN', label: 'Chi phí quản lý DN (642)' }
  if (a.startsWith('511') || a.startsWith('512')) return { code: 'DT', label: 'Doanh thu (511)' }
  if (a.startsWith('131')) return { code: 'PT', label: 'Phải thu khách (131)' }
  return { code: 'KHAC', label: `Khác (${a.slice(0, 3) || '—'})` }
}
