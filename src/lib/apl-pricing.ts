import prisma from './db'

// ─────────────────────────────────────────────────────────────────────────────
// Đơn giá khoán theo APL → thành tiền cho bước P5.5 (tổng hợp & tính lương khoán).
//
// Luật (chốt với nghiệp vụ 2026-08):
//   • Nhập đơn giá theo ITEM — cùng cấp với lệnh sản xuất (1 ITEM = 1 WO = 1 xưởng).
//     Cần chi tiết hơn thì đặt giá riêng cho một dòng chi tiết; dòng đó thắng giá ITEM.
//   • Thành tiền = đơn giá × KHỐI LƯỢNG ĐÃ NGHIỆM THU (không phải KL thiết kế).
//     Chưa làm / chưa đủ hai chữ ký → thành tiền = 0.
//   • Nhập được bất cứ lúc nào, không cần APL xong 100%.
//   • Chỉ CHỐT (Hoàn thành) khi: mọi ITEM đã có đơn giá VÀ mọi ITEM đã nghiệm thu xong.
// ─────────────────────────────────────────────────────────────────────────────

/** WO coi là đã nghiệm thu khi đủ hai chữ ký → trạng thái đã sang QC_PASSED (hoặc đã đóng). */
export const ACCEPTED_WO_STATUS = ['QC_PASSED', 'COMPLETED']

export interface ItemAcceptance {
  /** KL thiết kế của ITEM (tổng rollup các cụm bên trong) */
  plannedKg: number
  /** KL đã nghiệm thu — 0 nếu WO chưa đủ hai chữ ký, hoặc ITEM chưa phát hành WO */
  acceptedKg: number
  /** acceptedKg / plannedKg — dùng để chia KL nghiệm thu xuống từng dòng chi tiết */
  ratio: number
  blocks: number
  woCode: string | null
  woStatus: string | null
  teamCode: string | null
}

/**
 * KL đã nghiệm thu của từng ITEM trong một lần nhập APL.
 * Khoá của Map là tên ITEM ('' cho nhóm "(không có ITEM)" của bản APL cũ).
 */
export async function getAcceptanceByItem(importId: string): Promise<Map<string, ItemAcceptance>> {
  const heads = await prisma.aplLine.findMany({
    where: { importId, isAssembly: true },
    select: { id: true, item: true, rollupWeightKg: true },
  })

  // WO mới gắn ITEM; WO cũ gắn một dòng vàng → quy về ITEM của dòng vàng đó.
  const wos = await prisma.workOrder.findMany({
    where: {
      OR: [
        { aplImportId: importId },
        { aplLineId: { in: heads.map(h => h.id) } },
      ],
    },
    select: {
      aplLineId: true, aplImportId: true, aplItem: true,
      woCode: true, status: true, teamCode: true, completedQty: true,
    },
  })
  const itemOfLine = new Map(heads.map(h => [h.id, h.item || '']))

  const byItem = new Map<string, typeof wos>()
  for (const w of wos) {
    const key = w.aplImportId ? (w.aplItem || '') : itemOfLine.get(w.aplLineId || '')
    if (key === undefined) continue
    const arr = byItem.get(key) || []
    arr.push(w)
    byItem.set(key, arr)
  }

  const out = new Map<string, ItemAcceptance>()
  for (const h of heads) {
    const key = h.item || ''
    const cur = out.get(key) || {
      plannedKg: 0, acceptedKg: 0, ratio: 0, blocks: 0,
      woCode: null, woStatus: null, teamCode: null,
    }
    cur.plannedKg += Number(h.rollupWeightKg) || 0
    cur.blocks += 1
    out.set(key, cur)
  }

  for (const [key, acc] of out) {
    const list = byItem.get(key) || []
    const accepted = list.filter(w => ACCEPTED_WO_STATUS.includes(w.status))
    // completedQty đã bị chặn trần ở plannedWeight trong rollUpWorkOrder nên không vượt kế hoạch.
    acc.acceptedKg = accepted.reduce((s, w) => s + (Number(w.completedQty) || 0), 0)
    acc.ratio = acc.plannedKg > 0 ? Math.min(1, acc.acceptedKg / acc.plannedKg) : 0
    // Ưu tiên hiện WO đã nghiệm thu; chưa có thì hiện WO đang chạy để biết đang ở đâu
    const show = accepted[0] || list[0]
    acc.woCode = show?.woCode ?? null
    acc.woStatus = show?.status ?? null
    acc.teamCode = show?.teamCode || null
  }
  return out
}

/** Đơn giá hiệu lực của một dòng chi tiết: giá riêng của nó, không có thì lấy giá của ITEM. */
export function effectiveUnitPrice(
  ownPrice: number | null | undefined,
  itemPrice: number | null | undefined,
): number | null {
  if (ownPrice !== null && ownPrice !== undefined) return ownPrice
  if (itemPrice !== null && itemPrice !== undefined) return itemPrice
  return null
}

export interface PricingTotals {
  /** Tổng KL thiết kế của cả APL */
  plannedKg: number
  /** Tổng KL đã nghiệm thu */
  acceptedKg: number
  /** Tổng tiền = Σ (đơn giá hiệu lực × KL nghiệm thu của dòng chi tiết) */
  totalAmount: number
  /** Giá trị khoán theo kế hoạch — để đối chiếu, không phải số thực trả */
  plannedAmount: number
  itemsTotal: number
  itemsPriced: number
  itemsAccepted: number
  /** Số dòng chi tiết chưa có đơn giá hiệu lực */
  linesWithoutPrice: number
  /** Đủ điều kiện bấm Hoàn thành chưa */
  canComplete: boolean
  /**
   * Thành tiền của TỪNG ITEM, tính đúng cách như tổng: cộng theo dòng chi tiết để dòng nào
   * đặt giá riêng vẫn được tính. Nếu lấy `KL nghiệm thu × giá ITEM` thì cộng các dòng lại
   * sẽ không khớp Tổng tiền khi có dòng đặt giá riêng.
   */
  byItem: Map<string, { amount: number; plannedAmount: number; linesWithoutPrice: number }>
}

/**
 * Tính tổng cho cả bảng. Quét toàn bộ dòng (không phân trang) vì Tổng tiền phải đúng
 * trên TẤT CẢ dòng chứ không chỉ trang đang xem.
 */
export async function computePricingTotals(importId: string): Promise<PricingTotals> {
  const [details, linePrices, itemPrices, acceptance] = await Promise.all([
    prisma.aplLine.findMany({
      where: { importId, isAssembly: false },
      select: { id: true, item: true, totalWeightKg: true },
    }),
    prisma.aplLinePrice.findMany({ where: { importId }, select: { aplLineId: true, unitPrice: true } }),
    prisma.aplItemPrice.findMany({ where: { importId }, select: { item: true, unitPrice: true } }),
    getAcceptanceByItem(importId),
  ])

  const priceOfLine = new Map(linePrices.map(p => [p.aplLineId, Number(p.unitPrice)]))
  const priceOfItem = new Map(itemPrices.map(p => [p.item, Number(p.unitPrice)]))

  let totalAmount = 0
  let plannedAmount = 0
  let linesWithoutPrice = 0
  const byItem = new Map<string, { amount: number; plannedAmount: number; linesWithoutPrice: number }>()

  for (const d of details) {
    const key = d.item || ''
    const bucket = byItem.get(key) || { amount: 0, plannedAmount: 0, linesWithoutPrice: 0 }
    const unit = effectiveUnitPrice(priceOfLine.get(d.id), priceOfItem.get(key))
    if (unit === null) {
      linesWithoutPrice++
      bucket.linesWithoutPrice++
      byItem.set(key, bucket)
      continue
    }

    const plannedKg = Number(d.totalWeightKg) || 0
    // KL nghiệm thu của dòng chi tiết = KL thiết kế × tỉ lệ nghiệm thu của ITEM, nên
    // cộng các dòng chi tiết lại đúng bằng KL nghiệm thu của lệnh.
    const acceptedKg = plannedKg * (acceptance.get(key)?.ratio ?? 0)

    totalAmount += acceptedKg * unit
    plannedAmount += plannedKg * unit
    bucket.amount += acceptedKg * unit
    bucket.plannedAmount += plannedKg * unit
    byItem.set(key, bucket)
  }
  for (const b of byItem.values()) {
    b.amount = Math.round(b.amount)
    b.plannedAmount = Math.round(b.plannedAmount)
  }

  let plannedKg = 0
  let acceptedKg = 0
  let itemsPriced = 0
  let itemsAccepted = 0
  for (const [key, a] of acceptance) {
    plannedKg += a.plannedKg
    acceptedKg += a.acceptedKg
    if (a.acceptedKg > 0) itemsAccepted++
    if (priceOfItem.has(key)) itemsPriced++
  }

  const itemsTotal = acceptance.size
  return {
    plannedKg,
    acceptedKg,
    totalAmount: Math.round(totalAmount),
    plannedAmount: Math.round(plannedAmount),
    itemsTotal,
    itemsPriced,
    itemsAccepted,
    linesWithoutPrice,
    // Đủ cả hai: không còn dòng thiếu giá, và mọi ITEM đã nghiệm thu xong.
    canComplete: itemsTotal > 0 && linesWithoutPrice === 0 && itemsAccepted === itemsTotal,
    byItem,
  }
}
