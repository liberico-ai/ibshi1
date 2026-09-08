import prisma from './db'
import { getWoAcceptance, type KhoangNgay } from './wo-acceptance'
// Khoá + tên hạng mục để ở file riêng vì các trang dashboard cũng đọc, mà chúng không nhập
// được file này (kéo theo Prisma).
import { ITEM_CA_DU_AN } from './hang-muc'
export { ITEM_CA_DU_AN, tenHangMuc } from './hang-muc'

// ─────────────────────────────────────────────────────────────────────────────
// Đơn giá khoán theo APL → thành tiền cho bước P5.5 (tổng hợp & tính lương khoán).
//
// Luật (chốt với nghiệp vụ 2026-08):
//   • Nhập đơn giá theo ITEM — cùng cấp với lệnh sản xuất (1 ITEM = 1 WO = 1 xưởng).
//     Cần chi tiết hơn thì đặt giá riêng cho một dòng chi tiết; dòng đó thắng giá ITEM.
//   • Thành tiền = đơn giá × KHỐI LƯỢNG ĐÃ NGHIỆM THU (không phải KL thiết kế).
//     Chưa làm / chưa đủ hai chữ ký → thành tiền = 0.
//   • Nghiệm thu theo ĐỢT (09/2026): lệnh 50 tấn nghiệm thu 20 tấn thì trả tiền 20 tấn ngay,
//     không chờ trọn lệnh. KL nghiệm thu lấy theo tổng các đợt đã ký, không theo trạng thái WO.
//   • Nhập được bất cứ lúc nào, không cần APL xong 100%.
//   • Chỉ CHỐT (Hoàn thành) khi: mọi ITEM đã có đơn giá VÀ mọi ITEM đã nghiệm thu xong.
// ─────────────────────────────────────────────────────────────────────────────

/** Lệnh đã đóng sổ nghiệm thu — giữ lại cho các chỗ chỉ cần biết lệnh đã xong hay chưa. */
export const ACCEPTED_WO_STATUS = ['QC_PASSED', 'COMPLETED']

export interface ItemAcceptance {
  /** KL thiết kế của ITEM (tổng rollup các cụm bên trong) */
  plannedKg: number
  /** KL đã nghiệm thu — CỘNG DỒN phần đã ký của MỌI xưởng (xem ghi chú ở dưới) */
  acceptedKg: number
  /**
   * % hoàn thành của hạng mục — tính trên ĐÚNG những phần việc đã giao, không phải trên
   * khối lượng thiết kế.
   *
   * Giao cho 4 xưởng thì mẫu số là 4 phần việc đó; giao thêm xưởng thứ 5 thì mẫu số thành 5
   * và số % tụt xuống tương ứng; rút bớt một xưởng thì lại tính trên phần còn lại. Chưa giao
   * cho ai thì bằng 0 — chưa có việc nào để đo.
   *
   * Cách cũ lấy acceptedKg / KL thiết kế: mỗi lệnh mang TRỌN khối lượng hạng mục nên bốn
   * xưởng làm xong đọc ra 400%.
   */
  ratio: number
  /** Số phần việc (lệnh) đang được giao của hạng mục — chính là mẫu số của ratio. */
  woCount: number
  /** Mọi xưởng của ITEM đều đã nghiệm thu xong — dùng cho điều kiện chốt bảng. */
  allShopsDone: boolean
  blocks: number
  woCode: string | null
  woStatus: string | null
  teamCode: string | null
  /** Các lệnh của ITEM này — một ITEM giao cho nhiều xưởng thì có nhiều dòng */
  wos: {
    woCode: string; teamCode: string | null; status: string
    /** KL xưởng đã báo cộng dồn */
    reportedKg: number
    /** KL đã đủ hai chữ ký */
    acceptedKg: number
    /** KL kế hoạch của lệnh — theo ĐƠN VỊ CỦA LỆNH, không nhất thiết là kg */
    plannedKg: number
    /** Đơn vị đo của lệnh: kg, m², mét… */
    unit: string
    ratio: number
    /**
     * Công đoạn của lệnh — ĐƠN GIÁ KHOÁN đặt ở đây. Rỗng = lệnh chạy nguyên khối,
     * giá đặt cho cả lệnh của xưởng đó.
     */
    stages: {
      id: string; stageCode: string; name: string; category: string | null; unit: string
      plannedKg: number; reportedKg: number; acceptedKg: number; ratio: number
    }[]
  }[]
}

/**
 * KL đã nghiệm thu của từng ITEM trong một lần nhập APL.
 * Khoá của Map là tên ITEM ('' cho nhóm "(không có ITEM)" của bản APL cũ).
 */
export async function getAcceptanceByItem(
  importId: string,
  khoang?: KhoangNgay,
): Promise<Map<string, ItemAcceptance>> {
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
      id: true, aplLineId: true, aplImportId: true, aplItem: true,
      woCode: true, status: true, teamCode: true, completedQty: true, createdAt: true,
      // Lệnh giao cả dự án — không thuộc hạng mục nào, xếp vào khoá riêng.
      stagesDisjoint: true, plannedWeight: true,
    },
  })
  const itemOfLine = new Map(heads.map(h => [h.id, h.item || '']))

  const byItem = new Map<string, typeof wos>()
  for (const w of wos) {
    const key = w.stagesDisjoint
      ? ITEM_CA_DU_AN
      : (w.aplImportId ? (w.aplItem || '') : itemOfLine.get(w.aplLineId || ''))
    if (key === undefined) continue
    const arr = byItem.get(key) || []
    arr.push(w)
    byItem.set(key, arr)
  }

  const out = new Map<string, ItemAcceptance>()
  // Lệnh giao cả dự án không có dòng APL nào đứng sau, nên phải tự mở mục cho nó — khối lượng
  // giao lấy thẳng từ các lệnh đó (các chủng loại là khối lượng rời nhau nên cộng lại).
  const caDuAn = byItem.get(ITEM_CA_DU_AN) || []
  if (caDuAn.length > 0) {
    out.set(ITEM_CA_DU_AN, {
      plannedKg: caDuAn.reduce((s, w) => s + (Number(w.plannedWeight) || 0), 0),
      acceptedKg: 0, ratio: 0, woCount: 0, blocks: 0, allShopsDone: false,
      woCode: null, woStatus: null, teamCode: null, wos: [],
    })
  }
  for (const h of heads) {
    const key = h.item || ''
    const cur = out.get(key) || {
      plannedKg: 0, acceptedKg: 0, ratio: 0, woCount: 0, blocks: 0, allShopsDone: false,
      woCode: null, woStatus: null, teamCode: null, wos: [],
    }
    cur.plannedKg += Number(h.rollupWeightKg) || 0
    cur.blocks += 1
    out.set(key, cur)
  }

  // KL nghiệm thu lấy từ các ĐỢT đã ký — không dùng trạng thái WO, vì lệnh nghiệm thu dở dang
  // vẫn đang ở 'Đang SX' mà phần đã ký thì phải được trả tiền.
  const accByWo = await getWoAcceptance(wos.map(w => w.id), khoang)

  // ── Một ITEM giao cho NHIỀU xưởng ──
  // Xưởng cắt cắt trọn 93.671 kg, xưởng hàn hàn trọn 93.671 kg — mỗi lệnh mang TRỌN khối
  // lượng ITEM, không chia nhỏ.
  //
  // Tiền tính theo VIỆC ĐÃ LÀM và CỘNG DỒN (chốt 09/2026): mỗi lần một xưởng được nghiệm thu
  // thêm khối lượng nào thì cộng ngay khối lượng đó × đơn giá vào Thành tiền của ITEM. Xưởng
  // làm bao nhiêu trả bấy nhiêu, không chờ xưởng cuối cùng xong mới trả một cục.
  //
  // Hệ quả: KL nghiệm thu và tỉ lệ của ITEM có thể VƯỢT khối lượng thiết kế — ba xưởng cùng
  // làm trọn thì tỉ lệ là 3. Đó là đúng chứ không phải lỗi: ba lượt việc trên cùng khối lượng.
  // Vì vậy KHÔNG chặn trần ở 1.
  for (const [key, acc] of out) {
    const list = byItem.get(key) || []
    acc.wos = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(w => {
      const a = accByWo.get(w.id)
      // acceptedQty ở cấp lệnh đã là công đoạn CHẬM NHẤT, nên lệnh chia 2 công đoạn ký xong
      // cả hai chỉ được trả TRỌN một lần khối lượng hạng mục — không phải hai lần.
      const accepted = a?.acceptedQty || 0
      const planned = a?.plannedQty || 0
      return {
        woCode: w.woCode, teamCode: w.teamCode, status: w.status,
        // Đơn vị của LỆNH — có thể khác kg (sơn tính m²). Ba số dưới theo đơn vị đó.
        unit: a?.unit || 'kg',
        reportedKg: a?.reportedQty || 0, acceptedKg: accepted, plannedKg: planned,
        ratio: planned > 0 ? Math.min(1, accepted / planned) : 0,
        // Công đoạn của lệnh — đơn giá khoán đặt ở đây, không đặt cho cả hạng mục.
        stages: (a?.stages ?? []).map(st => ({
          id: st.id, stageCode: st.stageCode, name: st.name, category: st.category,
          unit: st.unit, plannedKg: st.plannedQty, reportedKg: st.reportedQty,
          acceptedKg: st.acceptedQty,
          ratio: st.plannedQty > 0 ? Math.min(1, st.acceptedQty / st.plannedQty) : 0,
        })),
      }
    })
    acc.acceptedKg = Math.round(acc.wos.reduce((s, w) => s + w.acceptedKg, 0) * 100) / 100
    // ── % hoàn thành của hạng mục: TRUNG BÌNH các phần việc ĐANG được giao ──
    //
    // Mẫu số đi theo phân giao thực tế, không phải một con số cố định: giao 4 xưởng thì chia
    // cho 4, giao thêm xưởng nữa thì chia cho 5 và % tụt xuống, bớt đi thì tính lại trên phần
    // còn lại. Ba xưởng xong hẳn + một xưởng mới nửa đường ⇒ (1+1+1+0,5)/4 = 87,5%.
    //
    // Chia theo phần việc chứ không cộng khối lượng: mỗi lệnh mang TRỌN khối lượng hạng mục
    // (cộng vào là ra 400% cho bốn xưởng), mà đơn vị cũng khác nhau — xưởng sơn tính m²,
    // xưởng hàn tính mét, không cộng chung được. Tỉ lệ của từng lệnh thì luôn so trong đơn vị
    // của chính nó nên trung bình được.
    acc.woCount = acc.wos.length
    acc.ratio = acc.woCount > 0
      ? acc.wos.reduce((s, w) => s + w.ratio, 0) / acc.woCount
      : 0
    // Chốt bảng thì vẫn đợi MỌI xưởng xong — trả dần không có nghĩa là kết thúc sớm.
    acc.allShopsDone = acc.wos.length > 0 && acc.wos.every(w => w.ratio >= 1)
    // Ưu tiên hiện WO đã nghiệm thu ít nhiều; chưa có thì hiện WO đang chạy để biết đang ở đâu
    const accepted = list.filter(w => (accByWo.get(w.id)?.acceptedQty || 0) > 0)
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

/** Đơn giá khoán của từng xưởng trong một ITEM: khoá "item::teamCode". */
export type WorkshopPriceMap = Map<string, number>

/**
 * Khoá tra ĐƠN GIÁ KHOÁN. Từ 07/09/2026 giá đặt theo CÔNG ĐOẠN của lệnh, không đặt cho cả
 * hạng mục nữa: pha cắt và bảo ôn là hai phần việc khác nhau, đơn giá khác nhau.
 * stageCode '' = lệnh chạy nguyên khối (giá cho cả lệnh của xưởng đó).
 */
export const shopKey = (item: string, teamCode: string | null, stageCode = '') =>
  `${item}::${teamCode || ''}::${stageCode}`

export interface PricingTotals {
  /** Tổng KL thiết kế của cả APL */
  plannedKg: number
  /** Tổng KL đã nghiệm thu */
  acceptedKg: number
  /** Tổng tiền = Σ (đơn giá hiệu lực × KL nghiệm thu của dòng chi tiết) */
  totalAmount: number
  /** TRẦN của cả bản APL = tổng (đơn giá ITEM × KL thiết kế ITEM) */
  plannedAmount: number
  itemsTotal: number
  itemsPriced: number
  itemsAccepted: number
  /** Số ITEM đã nghiệm thu xong mà tiền vượt trần */
  itemsOverCap: number
  /** Số XƯỞNG đã có khối lượng nghiệm thu nhưng chưa đặt đơn giá (tiền của họ = 0) */
  linesWithoutPrice: number
  /** Đủ điều kiện bấm Hoàn thành chưa */
  canComplete: boolean
  /**
   * Thành tiền của TỪNG ITEM, tính đúng cách như tổng: cộng theo dòng chi tiết để dòng nào
   * đặt giá riêng vẫn được tính. Nếu lấy `KL nghiệm thu × giá ITEM` thì cộng các dòng lại
   * sẽ không khớp Tổng tiền khi có dòng đặt giá riêng.
   */
  byItem: Map<string, {
    amount: number; plannedAmount: number; linesWithoutPrice: number
    cap: number | null; overCap: boolean; shopsWithoutPrice: number
  }>
}

/**
 * Tính tổng cho cả bảng. Quét toàn bộ dòng (không phân trang) vì Tổng tiền phải đúng
 * trên TẤT CẢ dòng chứ không chỉ trang đang xem.
 */
export async function computePricingTotals(importId: string): Promise<PricingTotals> {
  // Không còn quét 49.000 dòng chi tiết: tiền giờ tính theo XƯỞNG, chỉ cần đơn giá ITEM,
  // đơn giá xưởng và kết quả nghiệm thu.
  const [acceptance, shopPrices] = await Promise.all([
    getAcceptanceByItem(importId),
    prisma.aplItemWorkshopPrice.findMany({
      where: { importId }, select: { item: true, teamCode: true, stageCode: true, unitPrice: true },
    }),
  ])

  const priceOfShop: WorkshopPriceMap = new Map(
    shopPrices.map(p => [shopKey(p.item, p.teamCode, p.stageCode), Number(p.unitPrice)]))

  // ── Tiền tính theo ĐƠN GIÁ CỦA TỪNG CÔNG ĐOẠN (chốt 07/09/2026) ──
  //
  //   tiền(công đoạn) = KL đã nghiệm thu của công đoạn × đơn giá của công đoạn
  //   tiền(xưởng)     = tổng các công đoạn của lệnh đó
  //   Thành tiền ITEM = tổng các xưởng
  //   Tổng (giá trị khoán) = tổng (đơn giá công đoạn × KL GIAO của công đoạn)
  //
  // KHÔNG còn đơn giá cho cả hạng mục: pha cắt và bảo ôn là hai phần việc khác nhau, không có
  // một đơn giá chung nào nói đúng cả hai. Vì vậy cũng không còn "trần của hạng mục".
  //
  // Công đoạn đã có KL nghiệm thu mà CHƯA đặt đơn giá thì tiền = 0 và được đếm là thiếu giá —
  // đọc ra 0 đồng dễ tưởng làm không công, nên phải nêu rõ ở giao diện.
  //
  // Lệnh KHÔNG chia công đoạn: giá đặt cho cả lệnh của xưởng đó (stageCode '') như trước.
  //
  // Giá theo DÒNG CHI TIẾT (AplLinePrice) không còn tham gia. Bảng vẫn giữ, chưa xoá.
  let totalAmount = 0
  let plannedAmount = 0
  let shopsWithoutPrice = 0
  const byItem = new Map<string, {
    amount: number; plannedAmount: number; linesWithoutPrice: number
    /** Trần của hạng mục = đơn giá ITEM × KL thiết kế */
    cap: number | null
    /** Đã nghiệm thu xong ở mọi xưởng và tiền vượt trần */
    overCap: boolean
    shopsWithoutPrice: number
  }>()

  for (const [key, acc] of acceptance) {
    let amount = 0        // đã làm: theo KL đã nghiệm thu
    let khoan = 0         // giá trị khoán: theo KL giao
    let missing = 0
    for (const w of acc.wos) {
      if (w.stages.length > 0) {
        for (const st of w.stages) {
          const unit = priceOfShop.get(shopKey(key, w.teamCode, st.stageCode))
          if (unit === undefined) {
            if (st.acceptedKg > 0) { missing++; shopsWithoutPrice++ }
            continue
          }
          amount += st.acceptedKg * unit
          khoan += st.plannedKg * unit
        }
        continue
      }
      // Lệnh chạy nguyên khối — giá đặt cho cả lệnh.
      const unit = priceOfShop.get(shopKey(key, w.teamCode))
      if (unit === undefined) {
        if (w.acceptedKg > 0) { missing++; shopsWithoutPrice++ }
        continue
      }
      amount += w.acceptedKg * unit
      khoan += w.plannedKg * unit
    }
    amount = Math.round(amount)
    const cap = Math.round(khoan)
    // Không còn đơn giá hạng mục nên không còn khái niệm vượt trần.
    const overCap = false

    totalAmount += amount
    plannedAmount += cap
    byItem.set(key, {
      amount, plannedAmount: cap ?? 0, linesWithoutPrice: missing,
      cap, overCap, shopsWithoutPrice: missing,
    })
  }

  let plannedKg = 0
  let acceptedKg = 0
  let itemsPriced = 0
  let itemsAccepted = 0
  let itemsOverCap = 0
  for (const [key, a] of acceptance) {
    plannedKg += a.plannedKg
    acceptedKg += a.acceptedKg
    if (a.allShopsDone) itemsAccepted++
    // "Đã có đơn giá" = mọi phần việc đang có khối lượng nghiệm thu đều đã được đặt giá.
    if (byItem.get(key)?.shopsWithoutPrice === 0) itemsPriced++
    if (byItem.get(key)?.overCap) itemsOverCap++
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
    itemsOverCap,
    linesWithoutPrice: shopsWithoutPrice,
    // Chốt bảng khi mọi ITEM đã nghiệm thu xong ở mọi xưởng và không còn xưởng nào có
    // khối lượng mà thiếu đơn giá. VƯỢT TRẦN chỉ báo đỏ, KHÔNG chặn — để KTKH tự tính lại.
    canComplete: itemsTotal > 0 && shopsWithoutPrice === 0 && itemsAccepted === itemsTotal,
    byItem,
  }
}
