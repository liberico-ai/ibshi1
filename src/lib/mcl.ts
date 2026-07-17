/**
 * MCL — Material Control Log (bảng kiểm soát vật tư gộp per-material cho 1 dự án).
 *
 * READ-ONLY. Gộp dữ liệu vật tư đang nằm rải ở nhiều bảng thành 1 dòng / 1 vật tư:
 *   - Cần (needed)   : PurchaseRequestItem (ưu tiên) hoặc BomItem (fallback)
 *   - Đã đặt (PO)    : Σ PurchaseOrderItem.quantity của PO hợp lệ (loại DRAFT/CANCELLED/REJECTED)
 *   - Đã về (GRN)    : Σ PurchaseOrderItem.receivedQty (GRN cộng vào receivedQty của PO item)
 *   - Tồn            : Σ MaterialStock của kho tái sử dụng (COMMON/RETURN) + kho của chính dự án
 *   - Đã cấp (issue) : Σ MaterialIssue.quantity qua WorkOrder của dự án
 *   - Còn thiếu      : max(0, Cần − Tồn − (Đã đặt − Đã về))
 *                      = phần nhu cầu CHƯA được phủ bởi tồn kho khả dụng lẫn đơn đang mở.
 *
 * Gộp theo canonicalCode/itemCode: dòng có materialId → gộp theo materialId; dòng snapshot
 * (materialId = null, chỉ có itemCode) → thử resolve itemCode → materialId (qua codeToMaterialId),
 * nếu không resolve được thì gộp theo itemCode chuẩn hoá; cuối cùng fallback theo mô tả.
 *
 * Đây LÀ hàm thuần (không đụng Prisma) để test được. Route lo phần fetch DB.
 */

/** Trạng thái PO KHÔNG tính vào "Đã đặt" (đồng bộ với pr-coverage.ts) */
export const MCL_PO_EXCLUDED_STATUSES = ['DRAFT', 'CANCELLED', 'REJECTED']

/** Chuẩn hoá mã vật tư/itemCode để so khớp (trim + upper) */
export function normCode(code: string | null | undefined): string {
  return (code || '').trim().toUpperCase()
}

/** Nguồn "Cần": 1 dòng PR item hoặc BOM item đã fetch */
export interface MclDemandItem {
  materialId: string | null
  itemCode?: string | null
  description?: string | null
  profile?: string | null
  grade?: string | null
  unit?: string | null
  /** Mã/tên chuẩn từ quan hệ material (nếu có) */
  materialCode?: string | null
  materialName?: string | null
  quantity: number
}

/** Nguồn "Đã đặt"/"Đã về": 1 dòng PO item đã fetch */
export interface MclPoItem {
  materialId: string | null
  itemCode?: string | null
  description?: string | null
  profile?: string | null
  grade?: string | null
  unit?: string | null
  materialCode?: string | null
  materialName?: string | null
  ordered: number
  received: number
}

/** Nguồn "Tồn" / "Đã cấp": keyed theo materialId (bắt buộc có material) */
export interface MclMaterialQty {
  materialId: string
  materialCode?: string | null
  materialName?: string | null
  unit?: string | null
  quantity: number
}

export interface MclRow {
  key: string
  materialId: string | null
  itemCode: string
  description: string
  profile: string
  grade: string
  unit: string
  /** Cần theo PR */
  neededPr: number
  /** Cần theo BOM */
  neededBom: number
  /** Cần hiệu lực = neededPr nếu > 0, ngược lại neededBom */
  needed: number
  /** Đã đặt (PO hợp lệ) */
  ordered: number
  /** Đã về (GRN / receivedQty) */
  received: number
  /** Tồn khả dụng cho dự án */
  onHand: number
  /** Đã cấp cho sản xuất */
  issued: number
  /** Còn thiếu */
  shortage: number
}

export interface MclAggregateInput {
  prItems: MclDemandItem[]
  bomItems: MclDemandItem[]
  poItems: MclPoItem[]
  stocks: MclMaterialQty[]
  issues: MclMaterialQty[]
  /** normCode(itemCode | materialCode) → materialId — để hợp nhất dòng snapshot với dòng có material */
  codeToMaterialId: Map<string, string>
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Suy ra khoá gộp cho 1 dòng. Trả null nếu không có định danh nào (bỏ qua dòng). */
function resolveKey(
  materialId: string | null | undefined,
  itemCode: string | null | undefined,
  description: string | null | undefined,
  codeToMaterialId: Map<string, string>,
): string | null {
  if (materialId) return `m:${materialId}`
  const code = normCode(itemCode)
  if (code) {
    const mid = codeToMaterialId.get(code)
    if (mid) return `m:${mid}`
    return `c:${code}`
  }
  const desc = (description || '').trim().toLowerCase()
  if (desc) return `d:${desc}`
  return null
}

/** Lấy giá trị non-empty đầu tiên để điền cột hiển thị */
function fillFirst(current: string, incoming: string | null | undefined): string {
  if (current) return current
  return (incoming || '').trim()
}

/**
 * Gộp tất cả nguồn thành danh sách MclRow. Thuần — không side effect, không async.
 */
export function aggregateMcl(input: MclAggregateInput): MclRow[] {
  const { prItems, bomItems, poItems, stocks, issues, codeToMaterialId } = input
  const rows = new Map<string, MclRow>()

  const ensure = (key: string, materialId: string | null): MclRow => {
    let r = rows.get(key)
    if (!r) {
      r = {
        key,
        materialId: materialId ?? (key.startsWith('m:') ? key.slice(2) : null),
        itemCode: '',
        description: '',
        profile: '',
        grade: '',
        unit: '',
        neededPr: 0,
        neededBom: 0,
        needed: 0,
        ordered: 0,
        received: 0,
        onHand: 0,
        issued: 0,
        shortage: 0,
      }
      rows.set(key, r)
    }
    if (!r.materialId && materialId) r.materialId = materialId
    return r
  }

  const applyDisplay = (
    r: MclRow,
    d: { materialCode?: string | null; itemCode?: string | null; description?: string | null; materialName?: string | null; profile?: string | null; grade?: string | null; unit?: string | null },
  ) => {
    // Ưu tiên mã/tên canonical của material, sau đó snapshot
    r.itemCode = fillFirst(r.itemCode, d.materialCode) || fillFirst(r.itemCode, d.itemCode)
    r.description = fillFirst(r.description, d.materialName) || fillFirst(r.description, d.description)
    r.profile = fillFirst(r.profile, d.profile)
    r.grade = fillFirst(r.grade, d.grade)
    r.unit = fillFirst(r.unit, d.unit)
  }

  // ── Cần: PR ──
  for (const it of prItems) {
    const key = resolveKey(it.materialId, it.itemCode, it.description, codeToMaterialId)
    if (!key) continue
    const r = ensure(key, it.materialId ?? null)
    r.neededPr = round3(r.neededPr + (Number(it.quantity) || 0))
    applyDisplay(r, it)
  }

  // ── Cần: BOM (fallback) ──
  for (const it of bomItems) {
    const key = resolveKey(it.materialId, it.itemCode, it.description, codeToMaterialId)
    if (!key) continue
    const r = ensure(key, it.materialId ?? null)
    r.neededBom = round3(r.neededBom + (Number(it.quantity) || 0))
    applyDisplay(r, it)
  }

  // ── Đã đặt / Đã về: PO ──
  for (const it of poItems) {
    const key = resolveKey(it.materialId, it.itemCode, it.description, codeToMaterialId)
    if (!key) continue
    const r = ensure(key, it.materialId ?? null)
    r.ordered = round3(r.ordered + (Number(it.ordered) || 0))
    r.received = round3(r.received + (Number(it.received) || 0))
    applyDisplay(r, it)
  }

  // ── Tồn: MaterialStock (chỉ dòng có materialId) ──
  for (const s of stocks) {
    const key = `m:${s.materialId}`
    const r = ensure(key, s.materialId)
    r.onHand = round3(r.onHand + (Number(s.quantity) || 0))
    applyDisplay(r, { materialCode: s.materialCode, materialName: s.materialName, unit: s.unit })
  }

  // ── Đã cấp: MaterialIssue ──
  for (const is of issues) {
    const key = `m:${is.materialId}`
    const r = ensure(key, is.materialId)
    r.issued = round3(r.issued + (Number(is.quantity) || 0))
    applyDisplay(r, { materialCode: is.materialCode, materialName: is.materialName, unit: is.unit })
  }

  // ── Chốt: needed hiệu lực + còn thiếu ──
  const out: MclRow[] = []
  for (const r of rows.values()) {
    r.needed = r.neededPr > 0 ? r.neededPr : r.neededBom
    const openOrder = Math.max(0, r.ordered - r.received)
    r.shortage = round3(Math.max(0, r.needed - r.onHand - openOrder))
    out.push(r)
  }

  // Sắp xếp: còn thiếu giảm dần, rồi theo itemCode
  out.sort((a, b) => {
    if (b.shortage !== a.shortage) return b.shortage - a.shortage
    return a.itemCode.localeCompare(b.itemCode)
  })
  return out
}
