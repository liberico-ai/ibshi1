import * as XLSX from 'xlsx'

// Đọc Biên bản họp (MOM) theo mẫu IBS: Place/MOM No./Date/Prepared by/Subject/Attendants
// + bảng STT · Nội dung (DESCRIPTION) · Action by · Due date · Remark.
export interface ParsedMomItem { stt: string; noiDung: string; actionBy: string; dueDate: string; dueISO: string; remark: string; actionable: boolean }

// Dòng có phải "việc giao được" không (loại bỏ đề mục I/II/III, dòng mở đầu, tiêu đề kết thúc bằng ':')
function isActionable(stt: string, noiDung: string, actionBy: string, dueISO: string): boolean {
  const nd = noiDung.trim()
  if (!nd || nd.length < 6) return false
  if (/^[IVX]+$/i.test(stt.trim())) return false                 // đề mục La Mã: I, II…
  const endsColon = /[:：]\s*$/.test(nd)                          // "Hợp đồng:", "Thiết kế:"
  if (endsColon && !actionBy.trim() && !dueISO) return false      // tiêu đề nhóm, không phải việc
  if (/^(các phòng ban|nội dung|thống nhất|kết luận)/i.test(nd) && !actionBy.trim() && !dueISO) return false
  return true
}

// Trích ngày dạng ISO (yyyy-mm-dd) từ các chuỗi (dd/mm/yyyy, d-m-yy…) — để điền cột deadline
export function extractISO(...texts: string[]): string {
  for (const t of texts) {
    const m = /(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{2,4})/.exec(t || '')
    if (m) {
      const d = parseInt(m[1], 10), mo = parseInt(m[2], 10)
      let y = parseInt(m[3], 10); if (y < 100) y += 2000
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return ''
}
export interface ParsedMom {
  momNumber: string; place: string; date: string; preparedBy: string; subject: string
  attendants: string[]; items: ParsedMomItem[]; sheetName: string
}

function serialToStr(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000)
  const d = new Date(ms)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getUTCFullYear()}`
}
function cell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return (v > 25569 && v < 80000) ? serialToStr(v) : String(v)
  if (v instanceof Date) return serialToStr(Math.round(v.getTime() / 86400000) + 25569)
  return String(v).replace(/\s+/g, ' ').trim()
}
const test = (v: unknown, re: RegExp) => re.test(cell(v))

type Row = unknown[]
function rowsOf(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, defval: null, blankrows: false })
}
function headerIdx(rows: Row[]): number {
  return rows.findIndex((r) => r.some((c) => test(c, /STT|No\./i)) && r.some((c) => test(c, /Nội dung|DESCRIPTION/i)))
}

// Tìm giá trị bên phải của ô nhãn (vd "MOM No.") trong toàn sheet
function findLabel(rows: Row[], re: RegExp): string {
  for (const r of rows) {
    for (let c = 0; c < r.length; c++) {
      if (test(r[c], re)) {
        for (let k = c + 1; k < r.length; k++) {
          const v = cell(r[k])
          if (v && !test(r[k], re)) return v
        }
      }
    }
  }
  return ''
}

function extract(rows: Row[], sheetName: string): ParsedMom {
  const hIdx = headerIdx(rows)
  // Cột của từng trường theo hàng tiêu đề (chịu được merge/lệch cột)
  const hdr = hIdx >= 0 ? rows[hIdx] : []
  const colOf = (re: RegExp, fallback: number) => {
    const i = hdr.findIndex((c) => test(c, re))
    return i >= 0 ? i : fallback
  }
  const cStt = colOf(/STT|No\./i, 0)
  const cDesc = colOf(/Nội dung|DESCRIPTION/i, 1)
  const cAct = colOf(/Action by|Hành động/i, 2)
  const cDue = colOf(/Due date|Thời hạn/i, 3)
  const cRem = colOf(/Remark|Ghi chú/i, 4)

  // Thành phần tham dự: từ hàng "ATTENDANTS" tới khi gặp Subject/Acknowledge
  const attendants: string[] = []
  const atIdx = rows.findIndex((r) => r.some((c) => test(c, /ATTENDANTS|Thành phần/i)))
  if (atIdx >= 0) {
    for (let i = atIdx; i < (hIdx >= 0 ? hIdx : rows.length); i++) {
      for (const c of rows[i]) {
        const v = cell(c)
        if (!v) continue
        if (/ATTENDANTS|Thành phần|Acknowledge|nhất trí|Subject|Chủ đề/i.test(v)) continue
        attendants.push(v)
      }
    }
  }

  // Mục hành động
  const items: ParsedMomItem[] = []
  if (hIdx >= 0) {
    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i]
      const joined = r.map(cell).join(' ')
      if (/ĐẠI DIỆN|PHÒNG QLDA|PHÒNG SẢN XUẤT|representative/i.test(joined)) break
      const stt = cell(r[cStt]); const noiDung = cell(r[cDesc])
      const actionBy = cell(r[cAct]); const dueDate = cell(r[cDue]); const remark = cell(r[cRem])
      if (!stt && !noiDung && !actionBy && !dueDate && !remark) continue
      // Deadline: ưu tiên cột Due date, sau đó dò trong Ghi chú rồi Nội dung
      const dueISO = extractISO(dueDate, remark, noiDung)
      items.push({ stt, noiDung, actionBy, dueDate, dueISO, remark, actionable: isActionable(stt, noiDung, actionBy, dueISO) })
    }
  }

  return {
    momNumber: findLabel(rows, /MOM No|Số biên bản/i),
    place: findLabel(rows, /Place|Địa điểm/i),
    date: findLabel(rows, /^Date|Ngày/i),
    preparedBy: findLabel(rows, /Prepared by|Chuẩn bị bởi/i),
    subject: findLabel(rows, /Subject|Chủ đề/i),
    attendants, items, sheetName,
  }
}

export function parseMom(buffer: Buffer | ArrayBuffer): ParsedMom {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  // Chọn sheet có bảng mục hành động; nếu nhiều, lấy sheet CUỐI (bản mới nhất)
  let chosen = wb.SheetNames[0]
  for (const name of wb.SheetNames) {
    if (headerIdx(rowsOf(wb.Sheets[name])) >= 0) chosen = name
  }
  return extract(rowsOf(wb.Sheets[chosen]), chosen)
}
