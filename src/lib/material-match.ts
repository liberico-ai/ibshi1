// Khớp dòng PR (chưa link materialId) với Material trong kho khi MÃ hai hệ khác nhau
// (mã PR theo dự án: I109-VTC01-001 ≠ mã kho: VLC-TAM-014). Đối chiếu theo THUỘC TÍNH:
// tên + mác thép + độ dày tấm — thay cho việc so mã (khớp 0/1639).
//
// Đặc thù thép: PR cần MIẾNG CẮT (PL15x400x3900) còn kho trữ TẤM NGUYÊN (PL42x2000x7500)
// → không khớp kích thước; chỉ khớp ĐỘ DÀY (PL15) + MÁC (SS400), gộp tồn theo nhóm đó.

export interface MatStock {
  materialCode: string
  name: string
  specification: string | null
  grade: string | null
  unit: string
  available: number // currentStock − reservedStock (đã tính sẵn)
}
export interface PrItemAttrs {
  description?: string | null
  profile?: string | null
  grade?: string | null
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Độ dày tấm (mm) từ chuỗi quy cách: token PL<số> hoặc T<số> đầu tiên. null nếu không có. */
export function thicknessOf(s: unknown): string | null {
  const m = String(s ?? '').toUpperCase().match(/(?:PL|T)\s*([0-9]+(?:[.,][0-9]+)?)/)
  return m ? m[1].replace(',', '.') : null
}

/** Index tên (đã chuẩn hoá) → danh sách Material. */
export function buildMaterialIndex(mats: MatStock[]): Map<string, MatStock[]> {
  const idx = new Map<string, MatStock[]>()
  for (const m of mats) {
    const k = norm(m.name)
    if (!k) continue
    if (!idx.has(k)) idx.set(k, [])
    idx.get(k)!.push(m)
  }
  return idx
}

/**
 * Khớp 1 dòng PR chưa link → nhóm Material + tổng tồn khả dụng.
 * Thứ tự lọc: tên (bắt buộc) → mác (nếu PR có mác: chỉ giữ material cùng mác hoặc không ghi mác)
 * → độ dày (nếu PR có: chỉ giữ material cùng độ dày hoặc không ghi độ dày).
 * Trả null nếu không còn ứng viên nào (⇒ coi như NO_STOCK — an toàn, không báo tồn sai).
 */
export function matchByAttributes(item: PrItemAttrs, idx: Map<string, MatStock[]>): { materials: MatStock[]; available: number } | null {
  const name = norm(item.description)
  if (!name) return null
  let cands = idx.get(name)
  if (!cands || cands.length === 0) return null

  const g = norm(item.grade)
  if (g) {
    const byG = cands.filter(m => { const mg = norm(m.grade); return !mg || mg === g })
    if (byG.length === 0) return null // PR có mác nhưng không mã nào cùng mác → không dùng được
    cands = byG
  }

  // 1) Ưu tiên KHỚP ĐÚNG quy cách đầy đủ (thép hình C150x75…, hoặc tấm trùng size hiếm khi có)
  const prof = norm(item.profile)
  if (prof) {
    const exact = cands.filter(m => norm(m.specification) === prof)
    if (exact.length) return { materials: exact, available: sumAvail(exact) }
  }

  // 2) Thép TẤM: khớp theo ĐỘ DÀY (PR cần miếng cắt, kho trữ tấm nguyên — chỉ độ dày + mác là chung)
  const th = thicknessOf(item.profile)
  if (th) {
    const byT = cands.filter(m => thicknessOf(m.specification) === th)
    if (byT.length) return { materials: byT, available: sumAvail(byT) }
    return null // PR có độ dày tấm nhưng kho không có tấm cùng độ dày
  }

  // 3) Còn lại: chỉ nhận khi DUY NHẤT 1 ứng viên (tránh gộp nhầm nhiều quy cách khác nhau)
  if (cands.length === 1) return { materials: cands, available: sumAvail(cands) }
  return null // nhiều quy cách khác nhau, không đủ tin để khớp → coi như chưa xác định
}

const sumAvail = (ms: MatStock[]) => ms.reduce((s, m) => s + (Number(m.available) || 0), 0)
