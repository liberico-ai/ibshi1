import * as XLSX from 'xlsx'

// Đọc bảng PR/vật tư từ Excel (mẫu Purchase Requisition của IBS + mẫu đơn giản).
// Header điển hình: Item/STT · Description/Chi tiết · Profile/Vật tư · Grade/Mác · Unit/Đơn vị · Net Quantity
export interface PrRow { code: string; name: string; spec: string; unit: string; qty: string }

const S = (v: unknown): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

export function parsePrRows(buf: Buffer | ArrayBuffer): PrRow[] {
  const wb = XLSX.read(buf, { type: 'buffer' })
  // Ưu tiên sheet có nhiều dòng đọc được nhất
  let best: PrRow[] = []
  for (const name of wb.SheetNames) {
    // rowsF: giá trị đã định dạng (để nhận diện header/text); rowsR: giá trị thô (để giữ độ chính xác số lượng)
    const opts = { header: 1 as const, defval: '', blankrows: false }
    const rowsF = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { ...opts, raw: false })
    const rowsR = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { ...opts, raw: true })
    const got = extractSheet(rowsF, rowsR)
    if (got.length > best.length) best = got
  }
  return best
}

function extractSheet(rows: unknown[][], rowsRaw: unknown[][] = rows): PrRow[] {
  // Hàng tiêu đề: có (Item/STT/Mã/Code) VÀ (Description/Chi tiết/Tên/Name/Nội dung/Diễn giải/Vật tư)
  const hdr = rows.findIndex((r) =>
    r.some((c) => /\bitem\b|stt|\bmã\b|code/i.test(S(c))) &&
    r.some((c) => /description|chi ti[ếê]t|di[ễê]n gi[ảa]i|h[àa]ng h[óo]a|t[êe]n|name|n[ộo]i dung|v[ậa]t t[ưu]/i.test(S(c))))
  if (hdr < 0) return []
  const H = (rows[hdr] as unknown[]).map(S)
  const find = (re: RegExp) => H.findIndex((h) => re.test(h))
  const findAll = (re: RegExp) => H.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0)

  // Cột mã: ưu tiên "mã vật tư/code", nếu không có thì dùng cột Item/STT (mẫu PR chứa mã ở đây)
  const cCode = (() => {
    const m = find(/m[ãa]\s*(vt|v[ậa]t t[ưu])|materialcode|^m[ãa]\b|code/i)
    return m >= 0 ? m : find(/\bitem\b|stt/i)
  })()
  // Tên: ưu tiên Description/Chi tiết, rồi Tên/Name, cuối cùng mới tới "Vật tư"
  const cName = find(/description|chi ti[ếê]t|di[ễê]n gi[ảa]i|h[àa]ng h[óo]a/i) >= 0
    ? find(/description|chi ti[ếê]t|di[ễê]n gi[ảa]i|h[àa]ng h[óo]a/i)
    : (find(/^t[êe]n|name|n[ộo]i dung/i) >= 0 ? find(/^t[êe]n|name|n[ộo]i dung/i) : find(/v[ậa]t t[ưu]/i))
  const cProfile = find(/profile/i)
  const cGrade = find(/grade|m[áa]c/i)
  const cSpecExtra = find(/quy c[áa]ch|spec|k[íi]ch th[ưu][ớơ]c|ti[êe]u chu[ẩa]n/i)
  const cUnit = find(/unit|[đd][ơo]n v[ịi]|[đd]vt/i)
  // SL: ưu tiên cột "Total Ordered / Tổng dự trù" (tổng lượng đề nghị mua qua các lần dự trù),
  // nếu không có (mẫu PR đơn giản) thì mới lấy cột số lượng đầu tiên khớp (Net Quantity / Số lượng).
  const cQty = (() => {
    const total = find(/total ordered|t[ổo]ng d[ựu] tr[ùu]/i)
    if (total >= 0) return total
    const all = findAll(/net quantity|s[ốo] l[ưu][ợơ]ng|q\.?ty|^sl$/i)
    return all.length ? all[0] : -1
  })()

  const out: PrRow[] = []
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[]
    const rRaw = (rowsRaw[i] as unknown[]) || []
    const name = cName >= 0 ? S(r[cName]) : ''
    const code = cCode >= 0 ? S(r[cCode]) : ''
    const unit = cUnit >= 0 ? S(r[cUnit]) : ''
    // Số lượng: lấy giá trị thô (số thực, không bị làm tròn theo định dạng ô); nếu không phải số thì dùng text đã định dạng
    const qtyRaw = cQty >= 0 ? rRaw[cQty] : ''
    const qty = typeof qtyRaw === 'number' ? String(qtyRaw) : (cQty >= 0 ? S(r[cQty]) : '')
    if (!name && !code) continue
    if (/^\d+$/.test(name)) continue                                              // hàng đánh số cột (1 2 3…)
    if (/main-?material|accessory-?material|v[ậa]t t[ưu] ch[íi]nh|v[ậa]t t[ưu] ph[ụu]/i.test(name)) continue // dòng nhóm
    if (/priority|remarks?|assign cost|project budget|purpose|m[ụu]c [đd][íi]ch|ngu[ồo]n|ch[úu] [ýy]|th[ờơ]i gian c[ấâ]p/i.test(name + ' ' + code)) continue // chân trang
    if (!unit && !qty) continue                                                   // dòng vật tư thật phải có ĐVT hoặc SL
    const spec = [cProfile >= 0 ? S(r[cProfile]) : '', cGrade >= 0 ? S(r[cGrade]) : '', cSpecExtra >= 0 ? S(r[cSpecExtra]) : '']
      .filter(Boolean).join(' · ')
    out.push({ code, name, spec, unit, qty })
  }
  return out
}
