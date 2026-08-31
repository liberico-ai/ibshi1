import { saniWo } from './wbs-wo'

// Phát hành lệnh sản xuất từ APL.
//
// Từ 2026-08: MỖI ITEM = 1 WO = 1 XƯỞNG (trước đó là mỗi DÒNG VÀNG = 1 WO, ra tới 2.930 lệnh —
// quá vụn để phân giao). Khối lượng lấy tổng của cả ITEM, vật tư gom từ MỌI dòng chi tiết
// bên trong, trùng nhau thì cộng dồn.

export interface AplWoSource {
  /** id dòng APL (dòng vàng) */
  id: string
  /** thứ tự dòng trong file — quyết định số thứ tự khi mã lặp */
  rowNo: number
  assembly: string | null
}

/**
 * Mã WO cho một ITEM. Tên ITEM là chữ có dấu cách ("PLATFORM INDOOR-LOT2") nên phải chuẩn hoá.
 * Tên quá dài thì cắt — mã WO còn phải đọc được trên màn hình và in ra giấy.
 */
export function aplItemWoCode(projectCode: string, item: string, suffix?: number): string {
  const clean = saniWo((item || 'APL').trim()).slice(0, 40) || 'APL'
  const base = `WO-${saniWo(projectCode)}-${clean}`
  return suffix && suffix > 1 ? `${base}-${suffix}` : base
}

/** Mô tả WO theo ITEM: tên ITEM + số cụm bên trong, đủ để nhìn là biết lệnh gồm những gì. */
export function aplItemWoDescription(item: string, blocks: number): string {
  const name = (item || '').trim() || 'Chi tiết APL'
  return blocks > 0 ? `${name} (${blocks} cụm)` : name
}

export interface AplDetailLine {
  profile: string | null
  grade: string | null
  totalWeightKg: number | null
}

export interface RolledMaterial {
  /** nhãn vật tư theo cách ghi của bản vẽ, vd "PL10 SS400" */
  label: string
  /** khối lượng cộng dồn của mọi dòng chi tiết dùng vật tư này */
  weightKg: number
  /** gom từ bao nhiêu dòng chi tiết — để đối chiếu ngược khi số liệu trông lạ */
  lines: number
}

/**
 * Gom vật tư của mọi dòng chi tiết trong một ITEM: cùng (profile + grade) thì CỘNG DỒN khối lượng.
 * Sắp theo khối lượng giảm dần — vật tư nặng nhất là thứ cần lo trước khi đi mua.
 */
export function rollupItemMaterials(details: AplDetailLine[]): RolledMaterial[] {
  const acc = new Map<string, RolledMaterial>()
  for (const d of details) {
    const label = [d.profile, d.grade].map(x => (x || '').trim()).filter(Boolean).join(' ')
    if (!label) continue
    const row = acc.get(label) || { label, weightKg: 0, lines: 0 }
    row.weightKg += Number(d.totalWeightKg) || 0
    row.lines += 1
    acc.set(label, row)
  }
  return [...acc.values()].sort((a, b) => b.weightKg - a.weightKg)
}

/**
 * Chuỗi vật tư lưu vào WorkOrder.materials, dạng "PL10 SS400: 1.234 kg, L75x75x6 SS400: 567 kg".
 * Cột này chỉ để ĐỌC nhanh trên danh sách lệnh; số liệu thật để đi mua vẫn tính lại từ APL
 * ở màn Đề nghị cấp vật tư, nên cắt bớt cho khỏi phình là chấp nhận được.
 */
export function formatMaterialsColumn(mats: RolledMaterial[], maxItems = 40): string | null {
  if (mats.length === 0) return null
  const shown = mats.slice(0, maxItems)
  const text = shown
    .map(m => `${m.label}: ${Math.round(m.weightKg).toLocaleString('vi-VN')} kg`)
    .join(', ')
  const rest = mats.length - shown.length
  return rest > 0 ? `${text} … +${rest} loại nữa` : text
}

// ── Cách CŨ: mỗi dòng vàng = 1 WO. Giữ lại cho dữ liệu và test cũ ──
//
// Vướng thật của dữ liệu: cùng một mã ASSEMBLY xuất hiện ở NHIỀU dòng vàng — file I095-VOGT có
// 1.384 mã bị lặp, cá biệt V17565-MA-SC30A lặp 16 lần. Nếu lấy thẳng mã assembly làm mã WO thì
// đụng ràng buộc duy nhất của wo_code.
export function aplWoCodes(
  projectCode: string,
  picked: AplWoSource[],
  allOfAssembly: Map<string, AplWoSource[]>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of picked) {
    const key = (p.assembly || '').trim()
    const base = `WO-${saniWo(projectCode)}-${saniWo(key || 'APL')}`
    const siblings = allOfAssembly.get(key) || []
    if (!key || siblings.length <= 1) { out.set(p.id, base); continue }
    const ordered = [...siblings].sort((a, b) => a.rowNo - b.rowNo)
    const idx = ordered.findIndex(s => s.id === p.id)
    out.set(p.id, `${base}-${idx >= 0 ? idx + 1 : p.rowNo}`)
  }
  return out
}

/** Mô tả WO: lấy mô tả của dòng vàng, không có thì lùi về mã assembly. */
export function aplWoDescription(line: { description?: string | null; assembly?: string | null; item?: string | null }): string {
  const desc = (line.description || '').trim()
  const asm = (line.assembly || '').trim()
  const item = (line.item || '').trim()
  const head = desc || asm || 'Chi tiết APL'
  return item ? `${head} — ${item}` : head
}
