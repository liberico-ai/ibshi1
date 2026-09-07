import prisma from './db'

// ─────────────────────────────────────────────────────────────────────────────
// Nghiệm thu theo ĐỢT (chốt với nghiệp vụ 09/2026).
//
// Trước đây: xưởng phải làm xong 100% lệnh mới mời được QAQC + PM, nghiệm thu một phát
// là xong cả lệnh. Thực tế lệnh 50 tấn chạy hàng tháng — chờ đủ mới nghiệm thu thì xưởng
// không có gì để tính lương khoán suốt thời gian đó.
//
// Bây giờ: mỗi ITP là MỘT ĐỢT nghiệm thu cho một khối lượng cụ thể.
//   • Xưởng báo 20 tấn → mời nghiệm thu → đủ hai chữ ký → ghi nhận 20 tấn.
//   • Báo tiếp 10 tấn  → ITP đợt 2 cho 10 tấn → đủ hai chữ ký → cộng dồn thành 30 tấn.
//   • Hết khối lượng đã báo mà chưa nghiệm thu → không mời nghiệm thu được nữa.
//
// LỆNH CHIA CÔNG ĐOẠN (09/2026): mỗi công đoạn chạy qua TRỌN khối lượng của lệnh và được
// nghiệm thu RIÊNG — ký xong pha cắt không có nghĩa là đã ký bảo ôn. Vì vậy mọi con số đều
// tính theo TỪNG công đoạn (mảng `stages` bên dưới), tuyệt đối KHÔNG cộng các công đoạn lại:
// lệnh 24.784 kg hai công đoạn vẫn là lệnh 24.784 kg, không phải 49.568 kg.
//
// Con số ở cấp LỆNH là để trả lời "lệnh đi tới đâu", nên lấy công đoạn CHẬM NHẤT —
// cùng thước đo với tiến độ báo cáo (rollUpWorkOrder). Tiền cũng ăn theo số này nên
// một hạng mục không bao giờ được trả quá một lần khối lượng của nó.
// Lệnh không chia công đoạn: coi như có đúng một công đoạn là cả lệnh — mọi thứ cũ giữ nguyên.
//
// KL đã nghiệm thu của lệnh = TỔNG acceptedQty của các ITP đã đủ hai chữ ký (status COMPLETED).
// Không lưu số cộng dồn trên WorkOrder: tính lại từ ITP thì không bao giờ lệch với chữ ký.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Biên ±10% do cắt lẻ, hao hụt — dùng chung với rollUpWorkOrder để "báo đủ" và
 * "nghiệm thu đủ" cùng một thước đo. Đạt tỉ lệ này coi như trọn lệnh.
 */
export const WO_DONE_RATIO = 0.9

/** Tình hình nghiệm thu của MỘT công đoạn trong lệnh. Mọi số theo đơn vị của công đoạn. */
export interface WoStageAcceptance {
  id: string
  stageCode: string
  name: string
  category: string | null
  unit: string
  /** KL giao cho công đoạn này — bằng trọn khối lượng của lệnh */
  plannedQty: number
  /** KL xưởng đã báo cho riêng công đoạn này */
  reportedQty: number
  /** KL đã nghiệm thu xong của công đoạn này */
  acceptedQty: number
  /** KL của công đoạn này đang chờ đủ hai chữ ký */
  pendingQty: number
  /** KL của công đoạn này còn mời nghiệm thu được */
  availableQty: number
  /** KL đã bấm mời cho công đoạn này, QAQC chưa lập đợt — mời cái nào chỉ tính cái đó */
  invitedQty: number
  /** KL còn PHẢI bấm mời = availableQty − invitedQty */
  needInviteQty: number
  /** Công đoạn này đã nghiệm thu trọn (≥ 90%) */
  fullyAccepted: boolean
}

export interface WoAcceptance {
  /** Đơn vị đo của lệnh — kg, m², mét… Mọi số dưới đây đều theo đơn vị này. */
  unit: string
  /** KL kế hoạch của lệnh */
  plannedQty: number
  /** Từng công đoạn một. Lệnh không chia công đoạn thì mảng rỗng. */
  stages: WoStageAcceptance[]
  /** Số công đoạn của lệnh; 0 = lệnh chạy nguyên khối */
  stageCount: number
  /** KL xưởng đã báo — công đoạn CHẬM NHẤT, không cộng các công đoạn */
  reportedQty: number
  /** KL đã nghiệm thu xong — công đoạn CHẬM NHẤT; đây cũng là số dùng để tính tiền */
  acceptedQty: number
  /** KL đang chờ đủ hai chữ ký — tổng phần đang chờ của các công đoạn, để biết còn vướng gì */
  pendingQty: number
  /** Còn mời nghiệm thu được không — cộng phần mời được của mọi công đoạn */
  availableQty: number
  /** Tổng phần đã bấm mời mà QAQC chưa lập đợt */
  invitedQty: number
  /** Tổng phần còn phải bấm mời */
  needInviteQty: number
  /** Đã nghiệm thu trọn lệnh: MỌI công đoạn đều đạt ≥ 90% */
  fullyAccepted: boolean
  /** Có đợt nào bị chấm lỗi và chưa xử lý xong */
  hasFailed: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Khoảng ngày để lọc — dùng cho báo cáo khoán theo kỳ ("khoán tháng 9").
 * Bỏ trống = tính từ đầu tới giờ, đúng như mọi màn đang chạy.
 *
 * Áp vào NGÀY BÁO của phiếu công việc và NGÀY KIỂM của đợt nghiệm thu. Khối lượng KẾ HOẠCH
 * không lọc theo ngày — lệnh giao bao nhiêu vẫn là bấy nhiêu, không phụ thuộc kỳ đang xem.
 */
export interface KhoangNgay { tu?: Date; den?: Date }

const trongKhoang = (d: Date | null | undefined, k?: KhoangNgay) => {
  if (!k || (!k.tu && !k.den)) return true
  if (!d) return false
  if (k.tu && d < k.tu) return false
  if (k.den && d > k.den) return false
  return true
}

/** Tính tình hình nghiệm thu cho một loạt lệnh — 2 truy vấn cho cả danh sách. */
export async function getWoAcceptance(woIds: string[], khoang?: KhoangNgay): Promise<Map<string, WoAcceptance>> {
  const out = new Map<string, WoAcceptance>()
  if (woIds.length === 0) return out

  const wos = await prisma.workOrder.findMany({
    where: { id: { in: woIds } },
    select: { id: true, plannedWeight: true, completedQty: true, unit: true },
  })

  // Công đoạn của lệnh + khối lượng đã báo cho từng công đoạn. Không dùng completedQty ở đây:
  // completedQty là tiến độ của LỆNH (công đoạn chậm nhất), còn nghiệm thu ăn theo khối lượng
  // VIỆC đã báo — báo xong pha cắt là đã có việc để QC ký, dù chưa bảo ôn.
  const allStages = await prisma.workOrderStage.findMany({
    where: { workOrderId: { in: woIds } }, orderBy: { sortOrder: 'asc' },
    select: {
      id: true, workOrderId: true, stageCode: true, name: true,
      category: true, qty: true, unit: true, qcInvitedQty: true,
    },
  })
  const stagesByWo = new Map<string, typeof allStages>()
  for (const st of allStages) {
    const arr = stagesByWo.get(st.workOrderId) || []
    arr.push(st)
    stagesByWo.set(st.workOrderId, arr)
  }
  // Lệnh KHÔNG chia công đoạn: chỉ cần phiếu khi lọc theo kỳ (bình thường dùng completedQty).
  const woNguyenKhoi = woIds.filter(id => !stagesByWo.has(id))
  const cardsNguyenKhoi = (khoang?.tu || khoang?.den) && woNguyenKhoi.length > 0
    ? await prisma.jobCard.findMany({
      where: {
        workOrderId: { in: woNguyenKhoi }, status: { not: 'CANCELLED' },
        workDate: { ...(khoang.tu ? { gte: khoang.tu } : {}), ...(khoang.den ? { lte: khoang.den } : {}) },
      },
      select: { workOrderId: true, actualQty: true },
    })
    : []

  const woCoCongDoan = [...stagesByWo.keys()]
  const cards = woCoCongDoan.length > 0
    ? await prisma.jobCard.findMany({
      where: {
        workOrderId: { in: woCoCongDoan }, status: { not: 'CANCELLED' },
        // Lọc theo kỳ: chỉ đếm phiếu báo trong khoảng ngày đang xem.
        ...(khoang?.tu || khoang?.den
          ? { workDate: { ...(khoang.tu ? { gte: khoang.tu } : {}), ...(khoang.den ? { lte: khoang.den } : {}) } }
          : {}),
      },
      select: { workOrderId: true, stageId: true, actualQty: true },
    })
    : []

  const itps = await prisma.inspectionTestPlan.findMany({
    where: { workOrderId: { in: woIds } },
    select: {
      workOrderId: true, stageId: true, status: true, acceptedQty: true,
      inspectionDate: true, createdAt: true,
      // MỘT ITP cho cả lệnh, bên trong mỗi công đoạn một DÒNG mang khối lượng riêng và ký riêng.
      checkpoints: { select: { status: true, stageId: true, acceptedQty: true } },
    },
  })

  const byWo = new Map<string, typeof itps>()
  for (const i of itps) {
    if (!i.workOrderId) continue
    // Lọc theo kỳ: đợt nghiệm thu tính theo NGÀY KIỂM; đợt cũ không ghi ngày thì lấy ngày lập.
    if (!trongKhoang(i.inspectionDate ?? i.createdAt, khoang)) continue
    const arr = byWo.get(i.workOrderId) || []
    arr.push(i)
    byWo.set(i.workOrderId, arr)
  }

  for (const wo of wos) {
    const plannedQty = Number(wo.plannedWeight) || 0
    const unit = wo.unit || 'kg'
    const stageRows = stagesByWo.get(wo.id) || []
    const woItps = byWo.get(wo.id) || []
    let hasFailed = false

    // Phiếu / đợt không gắn công đoạn được tính cho MỌI công đoạn — dữ liệu lập trước khi
    // lệnh được chia công đoạn, bỏ đi thì lệnh đang chạy dở tự nhiên tụt về 0.
    const chungBao = cards
      .filter(c => c.workOrderId === wo.id && !c.stageId)
      .reduce((s, c) => s + (Number(c.actualQty) || 0), 0)

    /**
     * Cộng khối lượng đã ký / đang chờ ký của một công đoạn (null = cả lệnh, lệnh nguyên khối).
     *
     * ITP mới: mỗi công đoạn là MỘT DÒNG trong ITP, mang khối lượng riêng và cặp chữ ký riêng —
     * ký xong dòng pha cắt không kéo theo dòng bảo ôn.
     * ITP cũ: khối lượng nằm ở cấp ITP, đủ chữ ký ở mọi điểm kiểm mới tính.
     */
    const dotCua = (stageId: string | null, tranBao: number) => {
      let daKy = 0, choKy = 0
      for (const itp of woItps) {
        const dongCongDoan = itp.checkpoints.filter(c => c.stageId)
        if (dongCongDoan.length > 0) {
          for (const cp of dongCongDoan) {
            if (stageId === null || cp.stageId !== stageId) continue
            const q = Number(cp.acceptedQty) || 0
            if (cp.status === 'FAILED') { hasFailed = true; continue }
            if (cp.status === 'PASSED') daKy += q
            else choKy += q
          }
          continue
        }
        // ── ITP cũ ──
        if (stageId !== null && itp.stageId !== null && itp.stageId !== stageId) continue
        if (stageId === null && itp.stageId !== null) continue
        const cps = itp.checkpoints
        // Đợt cũ không ghi khối lượng — coi như nghiệm thu trọn phần đã báo lúc đó.
        const qty = itp.acceptedQty !== null ? Number(itp.acceptedQty) : tranBao
        if (cps.length > 0 && cps.some(c => c.status === 'FAILED')) { hasFailed = true; continue }
        if (cps.length > 0 && cps.every(c => c.status === 'PASSED')) daKy += qty
        else choKy += qty
      }
      return { daKy, choKy }
    }

    const stages: WoStageAcceptance[] = stageRows.map(st => {
      const giao = Number(st.qty) || 0
      const bao = Math.min(giao, cards
        .filter(c => c.stageId === st.id)
        .reduce((n, c) => n + (Number(c.actualQty) || 0), 0) + chungBao)
      const { daKy, choKy } = dotCua(st.id, bao)
      const daNghiemThu = round2(Math.min(daKy, Math.max(bao, giao)))
      const choKyR = round2(choKy)
      const conMoiDuoc = round2(Math.max(0, bao - daNghiemThu - choKyR))
      // Lời mời không được vượt phần thật sự còn chờ: xưởng mời 10.000 rồi QAQC ký xong thì
      // lời mời cũ hết giá trị, không được giữ lại làm lệnh treo ở "Chờ QC".
      const daMoi = round2(Math.min(conMoiDuoc, Number(st.qcInvitedQty) || 0))
      return {
        id: st.id, stageCode: st.stageCode, name: st.name, category: st.category,
        unit: st.unit || unit,
        plannedQty: round2(giao),
        reportedQty: round2(bao),
        acceptedQty: daNghiemThu,
        pendingQty: choKyR,
        availableQty: conMoiDuoc,
        invitedQty: daMoi,
        needInviteQty: round2(Math.max(0, conMoiDuoc - daMoi)),
        fullyAccepted: giao > 0 && daNghiemThu >= giao * WO_DONE_RATIO,
      }
    })

    if (stages.length > 0) {
      // Cấp LỆNH đọc theo công đoạn CHẬM NHẤT — không cộng các công đoạn lại.
      const tiLeThapNhat = Math.min(...stages.map(s => (s.plannedQty > 0 ? s.acceptedQty / s.plannedQty : 0)))
      const tiLeBaoThapNhat = Math.min(...stages.map(s => (s.plannedQty > 0 ? s.reportedQty / s.plannedQty : 0)))
      out.set(wo.id, {
        unit, plannedQty, stages, stageCount: stages.length,
        reportedQty: round2(plannedQty * tiLeBaoThapNhat),
        acceptedQty: round2(plannedQty * tiLeThapNhat),
        // Chờ ký / mời được: cộng của mọi công đoạn, vì đây là câu hỏi "còn việc gì phải ký".
        pendingQty: round2(stages.reduce((s, x) => s + x.pendingQty, 0)),
        availableQty: round2(stages.reduce((s, x) => s + x.availableQty, 0)),
        invitedQty: round2(stages.reduce((s, x) => s + x.invitedQty, 0)),
        needInviteQty: round2(stages.reduce((s, x) => s + x.needInviteQty, 0)),
        fullyAccepted: stages.every(x => x.fullyAccepted),
        hasFailed,
      })
      continue
    }

    // Lệnh chạy nguyên khối — y như trước khi có công đoạn.
    // completedQty là số cộng dồn TỪ ĐẦU nên không lọc theo kỳ được; có khoảng ngày thì
    // cộng lại từ phiếu công việc trong kỳ.
    const reportedQty = (khoang?.tu || khoang?.den)
      ? round2(Math.min(plannedQty || Infinity, cardsNguyenKhoi
        .filter(c => c.workOrderId === wo.id)
        .reduce((s, c) => s + (Number(c.actualQty) || 0), 0)))
      : Number(wo.completedQty) || 0
    const { daKy, choKy } = dotCua(null, reportedQty)
    const acceptedQty = round2(Math.min(daKy, Math.max(reportedQty, plannedQty)))
    const pendingQty = round2(choKy)
    out.set(wo.id, {
      unit, plannedQty, stages: [], stageCount: 0,
      reportedQty, acceptedQty, pendingQty,
      // Lệnh nguyên khối vẫn mời ở cấp lệnh như cũ — không có lời mời riêng để đếm.
      availableQty: round2(Math.max(0, reportedQty - acceptedQty - pendingQty)),
      invitedQty: 0,
      needInviteQty: round2(Math.max(0, reportedQty - acceptedQty - pendingQty)),
      fullyAccepted: plannedQty > 0 && acceptedQty >= plannedQty * WO_DONE_RATIO,
      hasFailed,
    })
  }
  return out
}

/** Tính cho đúng một lệnh. */
export async function getWoAcceptanceOne(woId: string): Promise<WoAcceptance | null> {
  return (await getWoAcceptance([woId])).get(woId) ?? null
}

/**
 * Lý do KHÔNG mở được đợt nghiệm thu cho MỘT công đoạn — null nghĩa là mở được.
 * Dùng chung cho API tạo ITP và màn tạo ITP, để hai bên không nói khác nhau.
 */
export function stageBlockReason(st: WoStageAcceptance): string | null {
  if (st.availableQty > 0) return null
  if (st.pendingQty > 0) {
    return `Đang chờ hai chữ ký ${st.pendingQty.toLocaleString('vi-VN')} ${st.unit}`
      + ' — ký xong đợt cũ rồi xưởng báo tiếp mới mở đợt mới được'
  }
  if (st.reportedQty <= 0) return 'Công đoạn này chưa có phiếu báo khối lượng nào'
  return 'Đã nghiệm thu hết phần xưởng đã báo — xưởng báo tiếp thì mới mở đợt được'
}

/**
 * Lý do KHÔNG mời nghiệm thu được — trả null nghĩa là mời được.
 * Dùng chung cho API tạo ITP và cho giao diện, để hai bên nói cùng một câu.
 */
export function blockReason(a: WoAcceptance): string | null {
  // Lệnh chia công đoạn: chỉ cần MỘT công đoạn có khối lượng đã báo chưa nghiệm thu là mời được.
  // Không bắt chờ công đoạn khác — xưởng cắt xong là ký được phần cắt.
  if (a.stageCount > 0) {
    if (a.stages.every(s => s.reportedQty <= 0)) return 'Lệnh chưa có phiếu báo khối lượng nào'
    // Đã bấm mời KHÔNG phải là chặn: QAQC chính là người mở đợt cho phần vừa được mời.
    // Chỉ hết phần chưa nghiệm thu mới là hết đường.
    if (a.availableQty > 0) return null
    const cho = a.stages.filter(s => s.pendingQty > 0)
    if (cho.length > 0) {
      return `Đang chờ nghiệm thu: ${cho.map(s => `${s.stageCode} ${s.name} ${s.pendingQty.toLocaleString('vi-VN')} ${s.unit}`).join('; ')}`
        + ' — ký xong đợt cũ rồi báo tiếp mới mời được'
    }
    return 'Đã nghiệm thu hết khối lượng đã báo — xưởng báo tiếp công đoạn nào thì mời nghiệm thu công đoạn đó'
  }
  if (a.reportedQty <= 0) return 'Lệnh chưa có phiếu báo khối lượng nào'
  if (a.availableQty <= 0) {
    if (a.pendingQty > 0) {
      return `Khối lượng đã báo đang chờ nghiệm thu (${a.pendingQty.toLocaleString('vi-VN')} ${a.unit}) — ký xong đợt cũ rồi báo tiếp mới mời được`
    }
    return 'Đã nghiệm thu hết khối lượng đã báo cáo — xưởng báo tiếp thì mới mời nghiệm thu được'
  }
  return null
}
