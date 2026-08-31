// Khớp vật tư trong APL (ký hiệu bản vẽ) với danh mục vật tư của kho (tên thương mại).
//
// Vì sao cần: hai bên nói hai thứ tiếng.
//     APL  : "A572GR50 / PL25"        "SS400 / H-400X400X13X21"
//     Kho  : "Thép tấm 20 A572/Gr.50"  "Thép H400x400x13x21x12000 SS400"
// So chuỗi thẳng chỉ khớp 12,5% khối lượng. Giải mã về (HÌNH DẠNG + KÍCH THƯỚC) rồi so thì
// lên 65% — đo trên file I95-VOGT, 1.802 cặp vật liệu×quy cách.
//
// Ba tầng, dùng đồng thời:
//   1. LUẬT   — giải mã ký hiệu, tự động, không cần ai khai
//   2. BÍ DANH — người dùng chỉ tay cặp nào ứng mã nào (lưu ở material_code_aliases)
//   3. CHƯA CÓ MÃ — kho thật sự chưa có, đẩy sang luồng tạo mã; KHÔNG ép khớp bừa
//
// Thuần, không I/O: nhận danh mục đã nạp sẵn để test được và để chỗ gọi tự quyết cách cache.

export interface ProfileKey {
  /** PL = thép tấm; còn lại là chữ đầu của ký hiệu hình (H, C, L, I, U…) */
  shape: string
  dims: number[]
}

export interface CatalogueItem {
  id: string
  materialCode: string
  name: string
  grade?: string | null
  specification?: string | null
  unit?: string
}

/** Một mã kho đã giải mã sẵn — chỗ gọi dựng một lần rồi dùng lại cho cả nghìn dòng. */
export interface IndexedMaterial extends CatalogueItem {
  key: ProfileKey | null
  /** tên + quy cách + mác, đã bỏ dấu và ký tự lạ — để dò mác thép */
  blob: string
}

export type MatchVia = 'alias' | 'rule' | 'history' | null

export interface MatchResult {
  via: MatchVia
  materialId: string | null
  materialCode: string | null
  materialName: string | null
  /** Khớp được quy cách nhưng mác thép không thấy trong tên mã kho → cần người xác nhận. */
  gradeMismatch: boolean
  /** Nhiều mã kho cùng khớp — nêu ra để người dùng chọn, không tự chọn bừa. */
  candidates: { id: string; materialCode: string; name: string }[]
}

// ── Chuẩn hoá ──

export function noAccent(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}
const squash = (s: string) => noAccent(s).replace(/[^A-Z0-9]/g, '')
const numsOf = (s: string): number[] => (s.match(/\d+(?:[.,]\d+)?/g) || []).map(x => Number(x.replace(',', '.')))

/**
 * Bỏ chiều dài CÂY TIÊU CHUẨN ở cuối (6000, 12000, 2440…). Kho ghi cả chiều dài cây,
 * bản vẽ thì không — không bỏ thì không bao giờ khớp.
 */
function dropStockLength(dims: number[]): number[] {
  return dims.length > 1 && dims[dims.length - 1] >= 1000 ? dims.slice(0, -1) : dims
}

// ── Giải mã ký hiệu ──

/** Ký hiệu quy cách trong APL → hình dạng + kích thước. */
export function parseAplProfile(profile: string | null | undefined): ProfileKey | null {
  // GIỮ dấu phân cách khi tách số. Bỏ hết dấu trước rồi mới tách thì "PL38*400" dính thành
  // một số 38400 — sai độ dày, và cặp đó nặng 106 tấn nên hỏng là hỏng lớn.
  const p = noAccent(profile || '').replace(/\s+/g, '')
  if (!p) return null
  // Thép tấm: PL25, PL38*400 — số ĐẦU là độ dày; số sau là khổ miếng cắt, không phải quy cách cây.
  if (/^PL\d/.test(p)) {
    const d = numsOf(p)
    return d.length ? { shape: 'PL', dims: [d[0]] } : null
  }
  const m = p.match(/^([A-Z]{1,3})[-.]?(\d.*)$/)
  if (!m) return null
  const dims = dropStockLength(numsOf(m[2]))
  return dims.length ? { shape: m[1], dims } : null
}

/** Tên + quy cách của mã kho → hình dạng + kích thước. */
export function parseCatalogueSpec(name: string, specification?: string | null): ProfileKey | null {
  const s = noAccent(`${name} ${specification || ''}`)
  // "Thép tấm 20 A572/Gr.50" → tấm dày 20. Bỏ mác thép trước khi lấy số, kẻo vớ nhầm "572".
  if (/THEP TAM|STEEL PLATE/.test(s)) {
    const cleaned = s.replace(/A\s?\d{3}|GR\.?\s?\d+|SUS\s?\d+|SS\s?\d{3}|SM\s?\d{3}|Q\d{3}/g, ' ')
    const d = numsOf(cleaned)
    return d.length ? { shape: 'PL', dims: [d[0]] } : null
  }
  const m = s.match(/\b([A-Z]{1,3})[-\s]?(\d+(?:[.,]\d+)?(?:\s?[X*]\s?\d+(?:[.,]\d+)?)+)/)
  if (!m) return null
  const dims = dropStockLength(numsOf(m[2]))
  return dims.length ? { shape: m[1], dims } : null
}

/**
 * Nhóm chữ hình tương đương: bản vẽ và kho gọi cùng một loại thép bằng chữ khác nhau.
 * Đo trên file thật, chỉ riêng luật này kéo tỉ lệ phủ từ 63,4% lên 77,5%:
 *   H ≡ I   — "H-244X175X7X11" của bản vẽ chính là mã VLC-I244-001 của kho
 *   C ≡ U   — "C-200X80X7.5X11" (178 tấn!) chính là VLC.U200.007
 *   CHS ≡ O — ống tròn
 *   SHS ≡ RHS ≡ BOX — hộp vuông/chữ nhật
 * KHÔNG gộp bừa: chỉ gộp các cặp mà kích thước đo theo cùng một quy ước.
 */
const SHAPE_FAMILY: Record<string, string> = {
  H: 'HI', I: 'HI',
  C: 'CU', U: 'CU',
  CHS: 'PIPE', O: 'PIPE', P: 'PIPE',
  SHS: 'BOX', RHS: 'BOX', BOX: 'BOX',
}
export const shapeFamily = (shape: string): string => SHAPE_FAMILY[shape] || shape

/** Hai bộ kích thước có coi là một không — so theo phần chung, cho phép bên kho ghi dài hơn. */
export function dimsCompatible(a: number[], b: number[]): boolean {
  const n = Math.min(a.length, b.length)
  if (n === 0) return false
  for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > 0.01) return false
  return true
}

/** Dựng chỉ mục danh mục kho — làm MỘT lần cho cả bảng. */
export function indexCatalogue(items: CatalogueItem[]): IndexedMaterial[] {
  return items.map(m => ({
    ...m,
    key: parseCatalogueSpec(m.name, m.specification),
    blob: squash(`${m.name} ${m.specification || ''} ${m.grade || ''}`),
  }))
}

// ── Kho tri thức từ LỊCH SỬ ──
//
// Trong hệ có sẵn hàng nghìn dòng PR/BOM mà NGƯỜI THẬT đã gắn quy cách với mã kho. Quan trọng:
// PR ghi quy cách theo đúng ký hiệu bản vẽ (PL10x2000x6000, CHS48.3*3.6) giống APL, nên dùng
// lại được ngay. Đây không phải máy đoán — là học lại việc người đã làm.
//
// Chỉ nhận khi một khoá ứng ĐÚNG MỘT mã kho; ứng nhiều mã thì bỏ, để người chọn.

export interface HistoryRow { profile: string | null; grade: string | null; materialId: string }
export interface HistoryIndex {
  /** khoá chặt: hình + kích thước + mác */
  tight: Map<string, Set<string>>
  /** khoá lỏng: hình + kích thước (dùng khi mác không trùng) */
  loose: Map<string, Set<string>>
}

function histKeys(profile: string | null | undefined, grade: string | null | undefined): { tight: string; loose: string } | null {
  const a = parseAplProfile(profile)
  if (!a) return null
  const loose = `${shapeFamily(a.shape)}|${a.dims.join('x')}`
  return { tight: `${loose}|${squash(grade || '')}`, loose }
}

export function buildHistoryIndex(rows: HistoryRow[]): HistoryIndex {
  const tight = new Map<string, Set<string>>()
  const loose = new Map<string, Set<string>>()
  for (const r of rows) {
    const k = histKeys(r.profile, r.grade)
    if (!k || !r.materialId) continue
    if (!tight.has(k.tight)) tight.set(k.tight, new Set())
    tight.get(k.tight)!.add(r.materialId)
    if (!loose.has(k.loose)) loose.set(k.loose, new Set())
    loose.get(k.loose)!.add(r.materialId)
  }
  return { tight, loose }
}

// ── Bí danh ──

/**
 * Khoá bí danh cho một cặp (mác thép, quy cách) của APL.
 * Có tiền tố "APL:" để không bao giờ đụng mã cũ thật trong material_code_aliases
 * (cột alias_code là DUY NHẤT toàn hệ thống).
 */
export function aplAliasKey(grade: string | null | undefined, profile: string | null | undefined): string {
  return `APL:${squash(grade || '')}|${squash(profile || '')}`
}

// ── Khớp ──

/**
 * @param aliases  khoá bí danh → mã kho (đã nạp sẵn)
 * @param history  kho tri thức từ PR/BOM cũ — chỉ dùng khi luật không tra được
 * @param index    danh mục đã giải mã sẵn
 */
export function matchAplMaterial(
  grade: string | null | undefined,
  profile: string | null | undefined,
  index: IndexedMaterial[],
  aliases: Map<string, IndexedMaterial>,
  history?: HistoryIndex,
): MatchResult {
  const empty: MatchResult = { via: null, materialId: null, materialCode: null, materialName: null, gradeMismatch: false, candidates: [] }

  // TẦNG 2 trước TẦNG 1: người dùng đã chỉ tay thì luôn thắng luật máy.
  const alias = aliases.get(aplAliasKey(grade, profile))
  if (alias) {
    return { via: 'alias', materialId: alias.id, materialCode: alias.materialCode, materialName: alias.name, gradeMismatch: false, candidates: [] }
  }

  const a = parseAplProfile(profile)
  if (!a) return empty
  const hits = index.filter(m => m.key && shapeFamily(m.key.shape) === shapeFamily(a.shape) && dimsCompatible(a.dims, m.key.dims))

  // TẦNG 1b — luật không tra được thì hỏi LỊCH SỬ. Chỉ chạy khi luật bó tay, nên nó chỉ THÊM
  // độ phủ chứ không bao giờ đè lên kết quả của luật.
  if (hits.length === 0) {
    if (!history) return empty
    const k = histKeys(profile, grade)
    if (!k) return empty
    const byId = new Map(index.map(m => [m.id, m]))
    for (const set of [history.tight.get(k.tight), history.loose.get(k.loose)]) {
      if (!set || set.size !== 1) continue     // ứng nhiều mã thì không đoán, để người chọn
      const m = byId.get([...set][0])
      if (!m) continue
      return { via: 'history', materialId: m.id, materialCode: m.materialCode, materialName: m.name, gradeMismatch: false, candidates: [] }
    }
    return empty
  }

  // Ưu tiên mã có nhắc tới đúng mác thép; không có thì vẫn trả về nhưng đánh dấu lệch mác.
  const g = squash(grade || '')
  const exact = g ? hits.filter(m => m.blob.includes(g)) : []
  const pick = exact[0] || hits[0]
  return {
    via: 'rule',
    materialId: pick.id,
    materialCode: pick.materialCode,
    materialName: pick.name,
    gradeMismatch: exact.length === 0,
    candidates: (exact.length ? exact : hits).slice(0, 8).map(m => ({ id: m.id, materialCode: m.materialCode, name: m.name })),
  }
}
