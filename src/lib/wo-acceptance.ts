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
// KL đã nghiệm thu của lệnh = TỔNG acceptedQty của các ITP đã đủ hai chữ ký (status COMPLETED).
// Không lưu số cộng dồn trên WorkOrder: tính lại từ ITP thì không bao giờ lệch với chữ ký.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Biên ±10% do cắt lẻ, hao hụt — dùng chung với rollUpWorkOrder để "báo đủ" và
 * "nghiệm thu đủ" cùng một thước đo. Đạt tỉ lệ này coi như trọn lệnh.
 */
export const WO_DONE_RATIO = 0.9

export interface WoAcceptance {
  /** KL kế hoạch của lệnh (kg) */
  plannedKg: number
  /** KL xưởng đã báo cáo cộng dồn (kg) */
  reportedKg: number
  /** KL đã nghiệm thu xong — tổng các đợt đủ hai chữ ký (kg) */
  acceptedKg: number
  /** KL đang nằm trong đợt chưa ký xong (kg) — đã mời nhưng chưa đủ hai chữ ký */
  pendingKg: number
  /** KL còn mời nghiệm thu được = đã báo − đã nghiệm thu − đang chờ ký (kg) */
  availableKg: number
  /** Đã nghiệm thu trọn lệnh (≥ 90% kế hoạch) */
  fullyAccepted: boolean
  /** Có đợt nào bị chấm lỗi và chưa xử lý xong */
  hasFailed: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Tính tình hình nghiệm thu cho một loạt lệnh — 2 truy vấn cho cả danh sách. */
export async function getWoAcceptance(woIds: string[]): Promise<Map<string, WoAcceptance>> {
  const out = new Map<string, WoAcceptance>()
  if (woIds.length === 0) return out

  const wos = await prisma.workOrder.findMany({
    where: { id: { in: woIds } },
    select: { id: true, plannedWeight: true, completedQty: true },
  })

  const itps = await prisma.inspectionTestPlan.findMany({
    where: { workOrderId: { in: woIds } },
    select: {
      workOrderId: true, status: true, acceptedQty: true,
      checkpoints: { select: { status: true } },
    },
  })

  const byWo = new Map<string, typeof itps>()
  for (const i of itps) {
    if (!i.workOrderId) continue
    const arr = byWo.get(i.workOrderId) || []
    arr.push(i)
    byWo.set(i.workOrderId, arr)
  }

  for (const wo of wos) {
    const plannedKg = Number(wo.plannedWeight) || 0
    const reportedKg = Number(wo.completedQty) || 0
    let acceptedKg = 0
    let pendingKg = 0
    let hasFailed = false

    for (const itp of byWo.get(wo.id) || []) {
      const cps = itp.checkpoints
      // Đợt cũ (trước khi có cột acceptedQty) không ghi khối lượng — coi như nghiệm thu trọn
      // phần đã báo tại thời điểm đó, tức là toàn bộ KL đã báo của lệnh.
      const qty = itp.acceptedQty !== null ? Number(itp.acceptedQty) : reportedKg
      if (cps.length > 0 && cps.some(c => c.status === 'FAILED')) { hasFailed = true; continue }
      // Đủ hai chữ ký ở mọi điểm kiểm → điểm kiểm sang PASSED → đợt được ghi nhận.
      if (cps.length > 0 && cps.every(c => c.status === 'PASSED')) acceptedKg += qty
      else pendingKg += qty
    }

    acceptedKg = round2(Math.min(acceptedKg, Math.max(reportedKg, plannedKg)))
    pendingKg = round2(pendingKg)
    out.set(wo.id, {
      plannedKg, reportedKg, acceptedKg, pendingKg,
      availableKg: round2(Math.max(0, reportedKg - acceptedKg - pendingKg)),
      fullyAccepted: plannedKg > 0 && acceptedKg >= plannedKg * WO_DONE_RATIO,
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
 * Lý do KHÔNG mời nghiệm thu được — trả null nghĩa là mời được.
 * Dùng chung cho API tạo ITP và cho giao diện, để hai bên nói cùng một câu.
 */
export function blockReason(a: WoAcceptance): string | null {
  if (a.reportedKg <= 0) return 'Lệnh chưa có phiếu báo khối lượng nào'
  if (a.availableKg <= 0) {
    if (a.pendingKg > 0) {
      return `Khối lượng đã báo đang chờ nghiệm thu (${a.pendingKg.toLocaleString('vi-VN')} kg) — ký xong đợt cũ rồi báo tiếp mới mời được`
    }
    return 'Đã nghiệm thu hết khối lượng đã báo cáo — xưởng báo tiếp thì mới mời nghiệm thu được'
  }
  return null
}
