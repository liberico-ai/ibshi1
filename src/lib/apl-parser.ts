// Đọc ASSEMBLY PART LIST (APL) từ Excel thiết kế — KHÔNG cố định cột, không cố định sheet.
//
// Vì sao phải mềm: file APL do thiết kế lập, mỗi dự án một kiểu. File I095-VOGT có 18 sheet,
// bảng chính 47 cột, trong đó nhiều cột riêng của dự án (P1/M1/F1/P2/P5/CP1/SY/bảo ôn/MẠ,
// LIST-U1, DTVT…) và có nhãn "PHÂN LOẠI" xuất hiện 2 lần. Bắt cứng theo chỉ số cột là hỏng
// ngay file sau.
//
// Nguyên tắc (giống estimate-parser / wbs-parser):
//   • Chọn sheet bằng NỘI DUNG (chấm điểm), không bằng tên sheet.
//   • Gán "vai" cho cột theo NHÃN trong file; cột không hiểu vẫn GIỮ nguyên vào `extra`.
//   • Dòng tiêu đề cụm (ASSEMBLY, chưa có PART) được đánh dấu riêng, không lẫn với dòng part.
//   • Thiếu cột là bình thường → cảnh báo, KHÔNG chặn.
//
// Thuần, không I/O: nhận vào mảng 2 chiều để test được và dùng chung client/server.

import { norm, toNumber, type Cell, type Row, type SheetMap, type SheetCandidate } from './estimate-parser'

export type { Cell, Row, SheetMap, SheetCandidate }

/** Trường đã hiểu được của một cột. null = cột lạ, cất vào `extra` theo nhãn gốc. */
export type AplField =
  | 'seq' | 'drawingNo' | 'assembly' | 'pos' | 'part' | 'markCutting' | 'item'
  | 'description' | 'profile' | 'grade' | 'typeCutting'
  | 'thicknessMm' | 'widthMm' | 'lengthMm'
  | 'qty' | 'unitWeightKg' | 'totalWeightKg' | 'areaM2'
  | 'category' | 'remark'

export interface AplColumn {
  index: number
  /** Khoá ổn định để lưu & render. Cột đã hiểu → tên trường; cột lạ → nhãn đã chuẩn hoá. */
  key: string
  label: string
  field: AplField | null
  numeric: boolean
}

export interface AplParsedLine {
  rowNo: number
  isAssembly: boolean
  seq: string | null
  drawingNo: string | null
  assembly: string | null
  pos: string | null
  part: string | null
  markCutting: string | null
  /** Cột ITEM — sản phẩm. MỘT item gồm nhiều dòng vàng (công đoạn). */
  item: string | null
  description: string | null
  profile: string | null
  grade: string | null
  typeCutting: string | null
  thicknessMm: number | null
  widthMm: number | null
  lengthMm: number | null
  qty: number | null
  unitWeightKg: number | null
  totalWeightKg: number | null
  areaM2: number | null
  category: string | null
  remark: string | null
  /** Số hiệu khối: dòng vàng và các dòng trắng của nó dùng chung một số. */
  blockNo: number
  /** CHỈ dòng vàng — khối lượng cộng từ các dòng trắng bên trong (không có dòng con thì lấy của chính nó). */
  rollupWeightKg: number | null
  /** CHỈ dòng vàng — TÊN vật tư gom từ các dòng trắng. Không kèm khối lượng: khối lượng vật tư
   *  chính là khối lượng dòng vàng rồi, tách ra theo từng vật liệu sẽ thành con số khác nghĩa. */
  rollupMaterials: string[] | null
  /** CHỈ dòng vàng — số dòng trắng bên trong. */
  childCount: number
  /** Mọi cột không nằm trong danh sách trên, theo nhãn gốc. */
  extra: Record<string, string | number>
}

export interface AplParseResult {
  ok: boolean
  reason?: 'NO_SHEET' | 'NO_HEADER' | 'NO_ROWS'
  sheetName?: string
  title?: string
  headerRow?: number
  columns: AplColumn[]
  lines: AplParsedLine[]
  /** Số liệu tổng hợp — dùng cho thẻ tóm tắt, khỏi phải quét lại 25k dòng. */
  summary: {
    totalRows: number
    assemblyRows: number
    partRows: number
    distinctAssemblies: number
    /** Cột tổng đang dùng thuộc phạm vi mấy UNIT (theo nhãn trong file). */
    scopeUnits: number
    totalWeightKg: number
    totalAreaM2: number
    /** PHÂN LOẠI → số dòng (SẮT HÀN / BOLT / GASKET…) */
    byCategory: Record<string, number>
  }
  warnings: string[]
  candidates: SheetCandidate[]
}

// ── Tiện ích ──

function cellText(v: Cell): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

function textOrNull(v: Cell): string | null {
  const t = cellText(v)
  return t ? t.slice(0, 500) : null
}

function numOrNull(v: Cell): number | null {
  if (v === '' || v == null) return null
  const n = toNumber(v)
  return Number.isFinite(n) ? n : null
}

function slug(label: string): string {
  return norm(label).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'x'
}

// ── Chấm điểm sheet ──

const SHEET_KEYWORDS: [string, number][] = [
  ['assembly', 3],
  ['mark cutting', 3],
  ['dwgnumber', 2],
  ['unit weight', 2],
  ['profile', 2],
  ['description', 1],
  ["q'ty", 2],
  ['part', 1],
]

export function scoreAplSheet(name: string, rows: Row[]): number {
  const head = rows.slice(0, 15).map(r => (r || []).map(norm).join(' ')).join(' | ')
  let score = 0
  for (const [kw, pts] of SHEET_KEYWORDS) if (head.includes(kw)) score += pts
  if (/assembly|apl/.test(norm(name))) score += 3
  // Bảng APL thật thì dài; sheet phụ vài chục dòng thì thôi
  if (rows.length >= 200) score += 2
  return score
}

// ── Tìm dòng tiêu đề ──

const HEADER_LABELS: RegExp[] = [
  /^no$|^stt$|^tt$/,
  /dwg ?number|drawing|ban ve/,
  /^assembly$|^assy$|cum lap/,
  /^part$|^part no$|piece mark/,
  /mark cutting|ma cat/,
  /description|mo ta|dien giai/,
  /^profile$|quy cach/,
  /^material$|^grade$|mac vat lieu/,
  /thick|do day/,
  /width|chieu rong/,
  /length|chieu dai/,
  /weight|khoi luong/,
  /q'?ty|qty|so luong|^sl /,
]

function headerScore(row: Row): number {
  let s = 0
  const seen = new Set<number>()
  for (const cell of row || []) {
    const t = norm(cell)
    if (!t) continue
    HEADER_LABELS.forEach((re, i) => { if (!seen.has(i) && re.test(t)) { s++; seen.add(i) } })
  }
  return s
}

function findHeaderRow(rows: Row[]): number {
  let best = -1
  let bestScore = 0
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const s = headerScore(rows[i] || [])
    if (s > bestScore) { bestScore = s; best = i }
  }
  return bestScore >= 6 ? best : -1
}

// ── Gán vai cho cột ──

// Thứ tự QUAN TRỌNG: mẫu hẹp đặt trước mẫu rộng. Ví dụ "MARK CUTTING" phải xét trước
// "^PART$", và "T. WEIGHT" trước "UNIT WEIGHT" (xem pickBest bên dưới).
const FIELD_PATTERNS: [AplField, RegExp][] = [
  ['markCutting', /mark cutting|ma cat|mark cat/],
  ['typeCutting', /type cutting|kieu cat/],
  ['drawingNo', /dwg ?number|drawing ?no|drawing|so ban ve|ban ve/],
  ['assembly', /^assembly$|^assy$|^cum$|cum lap/],
  ['pos', /^pos$|^position$|vi tri/],
  ['part', /^part$|^part ?no\.?$|^piece mark$|^mark$/],
  ['seq', /^no\.?$|^stt$|^tt$|^s\/n$/],
  ['item', /^item$|^san pham$|^ten san pham$/],
  ['description', /description|mo ta|dien giai|ten chi tiet/],
  ['profile', /^profile$|quy cach/],
  ['grade', /^material$|^grade$|^mac$|mac vat lieu|vat lieu/],
  ['thicknessMm', /thick|do day|^t ?\(mm\)$/],
  ['widthMm', /width|chieu rong|^w ?\(mm\)$/],
  ['lengthMm', /length|chieu dai|^l ?\(mm\)$/],
  ['category', /phan loai|category/],
  ['remark', /remark|ghi chu|note/],
]

// Cột số có nhiều biến thể trong cùng một file (Q'ty in dwg / SL cho 1 unit / T.Q'TY-2UNIT).
// Lấy theo THỨ TỰ ƯU TIÊN: tổng trước, rồi mới đến số lẻ — để "qty" luôn là con số dùng được.
const PICK_BEST: [AplField, RegExp[]][] = [
  ['qty', [/^t\.? ?q'?ty|total q'?ty|tong so luong/, /sl cho \d* ?unit|qty ?\/ ?unit|so luong\/|set ?\/ ?\d*unit/, /q'?ty|qty|so luong|^sl\b/]],
  ['totalWeightKg', [/^t\.? ?weight.*\d+ ?unit|total weight|tong khoi luong/, /^t\.? ?weight/, /weight.*kg/]],
  ['unitWeightKg', [/unit weight|khoi luong don vi|kg ?\/ ?(pc|cai)/, /^u\.? ?weight/]],
  ['areaM2', [/^t\.? ?area|total area|tong dien tich/, /^u\.? ?area|unit area/, /area|dien tich|m2/]],
]

/** Phạm vi của một cột tổng: "T. WEIGHT (KG) 2 UNIT" → 2, không ghi gì → 1. */
function unitScope(label: string): number {
  const m = norm(label).match(/(\d+)\s*units?\b/)
  const n = m ? Number(m[1]) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

function buildColumns(header: Row, body: Row[]): { columns: AplColumn[]; warnings: string[]; scopeUnits: number } {
  const width = Math.max(header.length, ...body.slice(0, 200).map(r => (r || []).length))
  const labels: { index: number; label: string }[] = []
  for (let j = 0; j < width; j++) {
    const label = cellText(header[j])
    if (label) labels.push({ index: j, label })
  }

  const assigned = new Map<number, AplField>()
  const taken = new Set<AplField>()
  let scopeUnits = 1

  // 1) Các trường "chọn tốt nhất" — quét theo từng mức ưu tiên.
  //    Trong cùng một mức, nếu file có nhiều cột tổng khác PHẠM VI ("T.WEIGHT 1 units" và
  //    "T.WEIGHT (KG) 2 UNIT") thì lấy cột phạm vi LỚN NHẤT, để số lượng và khối lượng luôn
  //    cùng một gốc. Trộn "SL cho 2 unit" với "KL cho 1 unit" là ra tổng sai.
  for (const [field, tiers] of PICK_BEST) {
    for (const re of tiers) {
      const hits = labels.filter(l => !assigned.has(l.index) && re.test(norm(l.label)))
      if (hits.length === 0) continue
      const hit = hits.reduce((best, l) => (unitScope(l.label) > unitScope(best.label) ? l : best), hits[0])
      assigned.set(hit.index, field)
      taken.add(field)
      if (field === 'qty' || field === 'totalWeightKg') scopeUnits = Math.max(scopeUnits, unitScope(hit.label))
      break
    }
  }

  // 2) Các trường khớp thẳng theo nhãn — mỗi trường chỉ lấy cột ĐẦU TIÊN khớp
  //    (file thật có "PHÂN LOẠI" 2 lần; cột thứ hai rơi về `extra`, không đè cột đầu).
  for (const [field, re] of FIELD_PATTERNS) {
    if (taken.has(field)) continue
    const hit = labels.find(l => !assigned.has(l.index) && re.test(norm(l.label)))
    if (hit) { assigned.set(hit.index, field); taken.add(field) }
  }

  const NUMERIC_FIELDS: AplField[] = ['thicknessMm', 'widthMm', 'lengthMm', 'qty', 'unitWeightKg', 'totalWeightKg', 'areaM2']
  const usedKeys = new Set<string>()
  const columns: AplColumn[] = labels.map(({ index, label }) => {
    const field = assigned.get(index) ?? null
    let key = field ?? slug(label)
    if (!field) {
      let n = 2
      let k = key
      while (usedKeys.has(k)) k = `${key}_${n++}`
      key = k
    }
    usedKeys.add(key)

    // Cột lạ: nhìn dữ liệu thật để biết cột số hay cột chữ (200 dòng đầu là đủ).
    let numeric = field ? NUMERIC_FIELDS.includes(field) : false
    if (!field) {
      let num = 0
      let txt = 0
      for (const r of body.slice(0, 200)) {
        const c = (r || [])[index]
        if (cellText(c) === '') continue
        if (typeof c === 'number' || /^[\d.,\-\s()%]+$/.test(String(c).trim())) num++
        else txt++
      }
      numeric = num > txt && num > 0
    }
    return { index, key, label, field, numeric }
  })

  const warnings: string[] = []
  const missing = (['assembly', 'part', 'description', 'profile', 'totalWeightKg'] as AplField[])
    .filter(f => !taken.has(f))
  if (missing.length) {
    const vi: Record<string, string> = {
      assembly: 'ASSEMBLY', part: 'PART', description: 'Description',
      profile: 'Profile', totalWeightKg: 'khối lượng tổng',
    }
    warnings.push(`Không thấy cột: ${missing.map(m => vi[m] || m).join(', ')} — các dòng vẫn nhận, chỉ thiếu ô đó.`)
  }
  const extras = columns.filter(c => !c.field)
  if (extras.length) {
    warnings.push(`${extras.length} cột riêng của dự án được giữ nguyên: ${extras.slice(0, 8).map(c => c.label).join(', ')}${extras.length > 8 ? '…' : ''}`)
  }
  if (scopeUnits > 1) {
    const qtyCol = columns.find(c => c.field === 'qty')
    const wCol = columns.find(c => c.field === 'totalWeightKg')
    warnings.push(`Số lượng & khối lượng lấy theo cột tổng cho ${scopeUnits} UNIT ("${qtyCol?.label || '?'}", "${wCol?.label || '?'}") — tức toàn bộ phạm vi dự án.`)
  }
  return { columns, warnings, scopeUnits }
}

// ── Gộp theo KHỐI (dòng vàng + các dòng trắng của nó) ──

/**
 * Chia danh sách dòng thành các KHỐI và tính sẵn phần cộng gộp cho dòng vàng.
 * Một khối = 1 dòng vàng (không có mã PART) + mọi dòng trắng liền sau tới dòng vàng kế.
 * Mỗi khối về sau thành MỘT lệnh sản xuất.
 *
 *  • Khối lượng dòng vàng = cộng cột "T. WEIGHT (KG) 2 UNIT" của các dòng trắng bên trong.
 *    Ô khối lượng SẴN CÓ trên dòng vàng không dùng — kiểm trên file thật thấy 57 dòng có số ở
 *    đó nhưng lệch hẳn tổng dòng con (1.035 vs 10.010). Riêng khối KHÔNG có dòng trắng nào
 *    (hàng mua / cụm nguyên khối) mới lấy chính ô của nó, nếu không sẽ hụt 117.946 kg.
 *  • Vật tư chỉ là danh sách TÊN, không kèm khối lượng — khối lượng của vật tư chính là khối
 *    lượng dòng vàng rồi, tách nhỏ theo từng vật liệu sẽ thành con số khác nghĩa.
 */
/** Nhãn vật tư của một dòng chi tiết: quy cách + mác. Thiếu bên nào thì lấy bên còn lại. */
export function matLabel(profile: string | null, grade: string | null): string {
  return [profile, grade].map(x => (x || '').trim()).filter(Boolean).join(' ')
}

export function rollupBlocks(lines: AplParsedLine[]): void {
  let blockNo = 0
  let head: AplParsedLine | null = null
  let weight = 0
  let sawChildWeight = false
  let mats = new Set<string>()

  const close = () => {
    if (!head) return
    // Khối lượng dòng vàng = CỘNG CÁC DÒNG TRẮNG bên trong nó (chốt nghiệp vụ 2026-08).
    // Ô khối lượng nằm sẵn trên chính dòng vàng KHÔNG dùng khi đã có dòng trắng: kiểm trên file
    // thật thấy 57 dòng như vậy và số của chúng không phải tổng của con (1.035 so với 10.010).
    // Chỉ khối KHÔNG có dòng trắng nào (hàng mua / cụm nguyên khối) mới lấy ô của chính nó,
    // nếu không sẽ mất hẳn 117.946 kg khỏi danh sách.
    head.rollupWeightKg = head.childCount > 0
      ? (sawChildWeight ? weight : null)
      : head.totalWeightKg
    // Vật tư gom từ các dòng trắng: QUY CÁCH + MÁC, ví dụ "L100*100*10 SS400".
    // Chỉ ghi mác không đủ — "SS400" thì không đặt hàng được, phải kèm quy cách mới ra mã kho.
    head.rollupMaterials = head.childCount > 0 ? [...mats] : [matLabel(head.profile, head.grade)].filter(Boolean)
  }

  for (const l of lines) {
    if (l.isAssembly) {
      close()
      blockNo++
      head = l
      weight = 0
      sawChildWeight = false
      mats = new Set()
      l.blockNo = blockNo
      l.childCount = 0
      continue
    }
    if (!head) { blockNo++; l.blockNo = blockNo; continue }   // dòng trắng mồ côi ở đầu bảng
    l.blockNo = blockNo
    head.childCount++
    if (typeof l.totalWeightKg === 'number') { weight += l.totalWeightKg; sawChildWeight = true }
    const lb = matLabel(l.profile, l.grade)
    if (lb) mats.add(lb)
  }
  close()
}

// ── Đọc bảng ──

/**
 * @param sheets  { [tên sheet]: mảng dòng (mảng ô) }
 * @param opts.sheetName  ép đọc đúng sheet này (khi người dùng tự chọn)
 */
export function parseAplSheets(sheets: SheetMap, opts?: { sheetName?: string }): AplParseResult {
  const candidates: SheetCandidate[] = Object.entries(sheets)
    .map(([name, rows]) => ({ name, score: scoreAplSheet(name, rows || []) }))
    .sort((a, b) => b.score - a.score)

  const empty = (reason: AplParseResult['reason'], sheetName?: string): AplParseResult => ({
    ok: false, reason, sheetName, columns: [], lines: [],
    summary: { totalRows: 0, assemblyRows: 0, partRows: 0, distinctAssemblies: 0, scopeUnits: 1, totalWeightKg: 0, totalAreaM2: 0, byCategory: {} },
    warnings: [], candidates,
  })

  const picked = opts?.sheetName && sheets[opts.sheetName]
    ? { name: opts.sheetName, score: candidates.find(c => c.name === opts.sheetName)?.score ?? 0 }
    : candidates[0]
  if (!picked || (!opts?.sheetName && picked.score < 8)) return empty('NO_SHEET')

  const rows = sheets[picked.name] || []
  const headerRow = findHeaderRow(rows)
  if (headerRow < 0) return empty('NO_HEADER', picked.name)

  const body = rows.slice(headerRow + 1)
  const { columns, warnings, scopeUnits } = buildColumns(rows[headerRow] || [], body)
  const colOf = (f: AplField) => columns.find(c => c.field === f)
  const cPart = colOf('part')

  const lines: AplParsedLine[] = []
  const assemblies = new Set<string>()
  const byCategory: Record<string, number> = {}
  let totalWeightKg = 0
  let totalAreaM2 = 0
  let assemblyRows = 0
  let quiet = 0

  const pickText = (row: Row, f: AplField) => { const c = colOf(f); return c ? textOrNull(row[c.index]) : null }
  const pickNum = (row: Row, f: AplField) => { const c = colOf(f); return c ? numOrNull(row[c.index]) : null }

  for (let i = 0; i < body.length; i++) {
    const row = body[i] || []
    if (!row.some(c => cellText(c) !== '')) {
      quiet++
      if (quiet >= 50 && lines.length > 0) break     // hết bảng, phần dưới là vùng trắng
      continue
    }
    quiet = 0

    const part = pickText(row, 'part')
    const pos = pickText(row, 'pos')
    const assembly = pickText(row, 'assembly')
    const description = pickText(row, 'description')
    // DÒNG CỤM = dòng KHÔNG chỉ đích danh một chi tiết nào: trống cả PART lẫn POS.
    //
    // Vì sao phải xét cả POS: hàng mua (grating, stud, gasket, bảo ôn…) ghi mã ở cột POS và
    // để trống PART. Chỉ xét PART thì 2.358 dòng chi tiết như vậy bị nhận nhầm thành dòng cụm.
    // Kiểm trên file thật, luật này cho: 2.930 dòng cụm, KHÔNG dòng cụm nào thiếu chi tiết,
    // không dòng chi tiết nào mồ côi, dòng cụm không bao giờ tự mang khối lượng, và tổng các
    // dòng chi tiết = 3.350.196 kg đúng bằng tổng ghi sẵn trong file.
    const isAssembly = !!cPart && !part && !pos && !!(assembly || description)

    const extra: Record<string, string | number> = {}
    for (const c of columns) {
      if (c.field) continue
      const v = row[c.index]
      if (cellText(v) === '') continue
      if (c.numeric) { const n = toNumber(v); if (Number.isFinite(n)) { extra[c.key] = n; continue } }
      extra[c.key] = cellText(v).slice(0, 500)
    }

    const totalW = pickNum(row, 'totalWeightKg')
    const area = pickNum(row, 'areaM2')
    const category = pickText(row, 'category')

    // Cộng CẢ dòng không có mã PART. Đối chiếu file thật: dòng tổng sẵn có ở đầu file
    // (3.350.196 kg) = cộng mọi dòng, trong đó 117.946 kg nằm ở các cụm mua/chế tạo nguyên
    // khối — không có PART nhưng vẫn có khối lượng. Bỏ chúng ra là hụt 3,5%.
    // Cha thật sự (đã tách thành dòng con) thì ô khối lượng để trống nên không đếm trùng.
    if (totalW) totalWeightKg += totalW
    if (area) totalAreaM2 += area
    if (category) byCategory[category] = (byCategory[category] || 0) + 1
    if (isAssembly) assemblyRows++
    if (assembly) assemblies.add(assembly)

    lines.push({
      rowNo: headerRow + 1 + i,
      isAssembly,
      seq: pickText(row, 'seq'),
      drawingNo: pickText(row, 'drawingNo'),
      assembly, pos, part,
      markCutting: pickText(row, 'markCutting'),
      item: pickText(row, 'item'),
      description,
      profile: pickText(row, 'profile'),
      grade: pickText(row, 'grade'),
      typeCutting: pickText(row, 'typeCutting'),
      thicknessMm: pickNum(row, 'thicknessMm'),
      widthMm: pickNum(row, 'widthMm'),
      lengthMm: pickNum(row, 'lengthMm'),
      qty: pickNum(row, 'qty'),
      unitWeightKg: pickNum(row, 'unitWeightKg'),
      totalWeightKg: totalW,
      areaM2: area,
      category,
      remark: pickText(row, 'remark'),
      blockNo: 0, rollupWeightKg: null, rollupMaterials: null, childCount: 0,
      extra,
    })
  }

  if (lines.length === 0) return empty('NO_ROWS', picked.name)

  rollupBlocks(lines)

  const firstText = cellText((rows[0] || []).find(c => cellText(c)) ?? '')

  return {
    ok: true,
    sheetName: picked.name,
    title: firstText.length > 5 ? firstText.slice(0, 250) : undefined,
    headerRow,
    columns,
    lines,
    summary: {
      totalRows: lines.length,
      assemblyRows,
      partRows: lines.length - assemblyRows,
      distinctAssemblies: assemblies.size,
      scopeUnits,
      totalWeightKg,
      totalAreaM2,
      byCategory,
    },
    warnings,
    candidates,
  }
}

/** Số hiệu bản sửa đổi lấy từ tên file / tiêu đề ("...-REV0-...", "Rev. 2"). Không có thì null. */
export function guessRevision(...sources: (string | undefined)[]): string | null {
  for (const s of sources) {
    if (!s) continue
    const m = s.match(/\brev\.?\s*([0-9]{1,2}[a-z]?)\b/i)
    if (m) return `REV${m[1].toUpperCase()}`
  }
  return null
}
