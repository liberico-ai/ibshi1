// ══════════════════════════════════════════════════════════════
// PR Normalizer — chuẩn hoá nhu cầu mua hàng nằm rải rác trong Task.resultData
//
// Bối cảnh: purchase_requests = 0 bản ghi; nhu cầu mua thật sự nằm trong
// Task.resultData dưới nhiều key + nhiều shape khác nhau (nợ kỹ thuật).
// File này là HÀM THUẦN: không đụng Prisma, không side-effect, không throw.
// Chưa có gì gọi nó — việc materialize PR là bước 3 (sau feature flag).
//
// ── Sự thật đo được trên prod (08/07/2026, 3232 dòng) ─────────
// • 6 key chứa nhu cầu mua: bomPrItems(2471) bomPr(731) paintData(16)
//   paintPrItems(8) weldPrItems(4) weldData(2)
// • TẤT CẢ đều DOUBLE-ENCODED: jsonb_typeof = 'string' (chuỗi chứa JSON),
//   không phải mảng jsonb → phải JSON.parse.
// • KEY KHÔNG QUYẾT ĐỊNH SHAPE: key `bomPr` chứa lẫn 724 dòng shape thép
//   + 6 dòng shape tiêu hao (hàn/sơn) + 1 dòng shape `name`.
//   ⟹ nhận diện theo SHAPE CỦA TỪNG DÒNG, không theo key.
// • Số có thể lưu dạng CHUỖI: {"quantity": "1", "needToBuyQty": "1"} → phải ép kiểu.
// • materialId NULL ở 1331/3202 dòng thép → PurchaseRequestItem.materialId
//   buộc phải nullable + có snapshot field (xem migration bước 2).
//
// ── 3 shape thật ──────────────────────────────────────────────
// A. Thép/BOM      : stt="I109-VTC01-002", description, profile, grade, unit,
//                    quantity, neededQty, availableQty, needToBuyQty, materialId, requiredDate
// B. Tiêu hao(hàn/sơn): stt="1" (SỐ THỨ TỰ, không phải mã), description, spec,
//                    unit, quantity, category:'weld'|'paint'
// C. `name`        : {code:"", name:"Mũi khoan chuôi côn F51", quantity:"1", needToBuyQty:"1"}
//                    → nhãn ở `name`, KHÔNG có `description`
// ══════════════════════════════════════════════════════════════

/** Các key trong resultData có thể chứa nhu cầu mua hàng. */
export const PR_RESULT_KEYS = [
  'bomPrItems',
  'bomPr',
  'weldPrItems',
  'paintPrItems',
  'weldData',
  'paintData',
] as const

// CỐ TÌNH KHÔNG lấy `supplierQuotes`: đó là BÁO GIÁ của nhà cung cấp CHO một PR
// (đơn giá, vendor) — không phải nhu cầu mua. Gộp vào sẽ nhân đôi số lượng.

/** Một dòng PR đã chuẩn hoá — khớp snapshot field của PurchaseRequestItem (bước 2). */
export interface PrLine {
  itemCode?: string
  description?: string
  profile?: string
  grade?: string
  unit?: string
  quantity: number
  requiredDate?: Date | null
  notes?: string
  materialId?: string | null
}

// ── helper thuần ────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Chỉ khớp phân cách NGHÌN kiểu Anh–Mỹ: 1,500 · 12,345.67 (KHÔNG khớp "1,5") */
const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/

/**
 * Ép về số hữu hạn. Chấp nhận number lẫn CHUỖI SỐ ("1", "0.175") — dữ liệu thật
 * trong Task.resultData có lưu số dạng chuỗi (vd {"quantity":"1"}).
 * Không hợp lệ → null.
 *
 * ⚠️ Dấu phẩy: chỉ xoá khi đúng dạng phân cách nghìn ("1,500" → 1500).
 * KHÔNG xoá mù, vì tiếng Việt "1,5" nghĩa là 1.5 — xoá phẩy sẽ thành 15 (sai 10 lần).
 * Chuỗi phẩy nhập nhằng → null (từ chối) thay vì đoán sai số lượng mua hàng.
 */
export function toQtyOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return null
    const cleaned = THOUSANDS.test(s) ? s.replace(/,/g, '') : s
    const n = Number(cleaned) // "1,5" → NaN → null (an toàn)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Như toQtyOrNull nhưng mặc định 0 — dùng cho chỗ cần số để tính toán. */
export function toQty(v: unknown): number {
  return toQtyOrNull(v) ?? 0
}

const toNum = toQtyOrNull

/** Chuỗi đã trim; rỗng → undefined. */
function toStr(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const s = v.trim()
    return s === '' ? undefined : s
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return undefined
}

/** Ngày hợp lệ → Date; còn lại → null. */
function toDate(v: unknown): Date | null {
  const s = toStr(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Lấy mảng item từ giá trị của một key.
 * Xử lý DOUBLE-ENCODED: giá trị thường là CHUỖI chứa JSON → JSON.parse.
 * JSON hỏng → log + trả [] (KHÔNG throw: một task lỗi không được làm sập cả luồng).
 */
function parseItemArray(raw: unknown, keyName: string): unknown[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (s === '') return []
    try {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      console.warn(`[pr-normalizer] JSON hỏng ở key "${keyName}" — bỏ qua key này`)
      return []
    }
  }
  return []
}

/**
 * Số lượng CẦN MUA của một dòng.
 * Ưu tiên `needToBuyQty` (đã trừ tồn kho) — giống hệt create-po, tránh đề nghị
 * mua thứ đã có trong kho. Không có thì lùi về quantity → totalQty → netQty.
 * needToBuyQty = 0 (đủ kho) → 0 → dòng bị loại ở bước lọc. Đúng ý nghĩa PR.
 */
function pickQuantity(item: Record<string, unknown>): number | null {
  if ('needToBuyQty' in item) {
    const n = toNum(item.needToBuyQty)
    if (n !== null) return n
  }
  return toNum(item.quantity) ?? toNum(item.totalQty) ?? toNum(item.netQty)
}

/**
 * Mã vật tư. Ưu tiên mã thật; `stt` chỉ dùng khi nó KHÔNG phải số thứ tự thuần.
 * Shape thép: stt = "I109-VTC01-002" → là mã.
 * Shape tiêu hao: stt = "1" → chỉ là STT, dùng làm mã sẽ ra rác.
 */
function pickItemCode(item: Record<string, unknown>): string | undefined {
  const direct =
    toStr(item.canonicalCode) ?? toStr(item.code) ?? toStr(item.provisionalCode)
  if (direct) return direct
  const stt = toStr(item.stt)
  if (!stt || /^\d+$/.test(stt)) return undefined
  return stt
}

/** Một item thô (bất kỳ shape nào) → PrLine, hoặc null nếu không phải nhu cầu mua hợp lệ. */
function mapItem(raw: unknown): PrLine | null {
  if (!isPlainObject(raw)) return null

  const quantity = pickQuantity(raw)
  if (quantity === null || quantity <= 0) return null // loại dòng tiêu đề/khối lượng 0/đủ kho

  const itemCode = pickItemCode(raw)
  // Shape C dùng `name` thay cho `description`.
  const description = toStr(raw.description) ?? toStr(raw.name)
  if (!itemCode && !description) return null // không định danh được → bỏ

  const materialIdRaw = toStr(raw.materialId)

  return {
    itemCode,
    description,
    profile: toStr(raw.profile),
    grade: toStr(raw.grade),
    unit: toStr(raw.unit),
    quantity,
    requiredDate: toDate(raw.requiredDate),
    // Shape thép ghi chú ở `remarks`; shape tiêu hao ở `spec`.
    notes: toStr(raw.remarks) ?? toStr(raw.spec),
    materialId: materialIdRaw ?? null,
  }
}

/**
 * Nhận resultData của BẤT KỲ task nào → danh sách dòng PR chuẩn.
 * Rỗng nếu task không chứa nhu cầu mua. Không bao giờ throw.
 */
export function normalizePrLines(resultData: unknown): PrLine[] {
  if (!isPlainObject(resultData)) return []

  const lines: PrLine[] = []
  for (const key of PR_RESULT_KEYS) {
    if (!(key in resultData)) continue
    for (const raw of parseItemArray(resultData[key], key)) {
      const line = mapItem(raw)
      if (line) lines.push(line)
    }
  }
  return lines
}

/** Task có nhu cầu mua hàng không? (dùng ở bước 3 để quyết định materialize) */
export function hasPrData(resultData: unknown): boolean {
  return normalizePrLines(resultData).length > 0
}
