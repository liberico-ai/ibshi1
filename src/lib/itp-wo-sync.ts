import prisma from './db'
import { isWorkOrderQcPassed } from './qc-gate'
import { logAudit } from './auth'
import { getWoAcceptance, type WoAcceptance } from './wo-acceptance'

// ─────────────────────────────────────────────────────────────────────────────
// Đồng bộ kết quả nghiệm thu ITP → trạng thái QC của lệnh sản xuất.
//
// Màn WO không còn nút "QC Đạt / Không đạt": kết quả do màn Kế hoạch Kiểm tra quyết định.
// Vì vậy việc đồng bộ KHÔNG được phụ thuộc vào đúng một lần bấm — nếu lần đó lỗi mạng,
// hoặc ITP đã đạt từ trước khi có luật này, thì WO kẹt ở "Chờ QC" vĩnh viễn mà không có
// đường gỡ. Hàm dưới đây tự so lại và tự sửa, gọi bao nhiêu lần cũng cho cùng kết quả.
// ─────────────────────────────────────────────────────────────────────────────

// QC_PASSED nằm trong danh sách vì nghiệm thu theo ĐỢT: lệnh đã ký trọn phần cũ mà xưởng báo
// thêm khối lượng thì phần mới CHƯA ai ký — phải mở lại, không thì lệnh đứng ở 'QC Đạt' vĩnh viễn
// và không còn đường mời nghiệm thu tiếp. COMPLETED thì thôi: đã đóng sổ thì không tự mở lại.
const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'QC_PENDING', 'QC_FAILED', 'ON_HOLD', 'PENDING_MATERIAL', 'QC_PASSED']

export interface WoQcSyncResult {
  woId: string
  woCode: string
  from: string
  to: string
}

/**
 * Trạng thái QC mà kết quả nghiệm thu đang chỉ định cho một WO:
 *   • có đợt bị chấm lỗi        → QC_FAILED
 *   • đã nghiệm thu TRỌN lệnh   → QC_PASSED
 *   • còn lại                   → null (không đụng vào WO)
 *
 * Nghiệm thu từng đợt nên đợt đầu ĐẠT KHÔNG có nghĩa là xong lệnh: lệnh 50 tấn nghiệm thu
 * 20 tấn thì vẫn đang sản xuất, phải chờ nghiệm thu đủ (biên 90% như lúc báo khối lượng)
 * mới được coi là xong.
 */
function verdictFrom(acc: WoAcceptance | undefined, current: string): 'QC_PASSED' | 'QC_FAILED' | 'QC_PENDING' | 'IN_PROGRESS' | null {
  if (!acc) return null
  if (acc.hasFailed) return 'QC_FAILED'

  // Đã nghiệm thu trọn lệnh?
  const done = acc.plannedKg > 0
    ? acc.fullyAccepted
    : acc.acceptedKg > 0 && acc.pendingKg <= 0 && acc.availableKg <= 0
  if (done) return 'QC_PASSED'

  // Chưa trọn lệnh mà đang mang nhãn 'QC Đạt' / 'Chờ QC' → trả về đúng chỗ nó đang đứng,
  // nếu không thì ký xong đợt này là lệnh kẹt luôn, không còn đường mời đợt sau.
  if (current === 'QC_PENDING' || current === 'QC_PASSED') {
    // Còn đợt chưa đủ hai chữ ký → vẫn đang chờ nghiệm thu.
    if (acc.pendingKg > 0) return 'QC_PENDING'
    // 'Chờ QC' CÒN khối lượng chưa nghiệm thu = lời mời còn nguyên giá trị (QAQC chưa kịp lập
    // ITP cho đợt đó). Hạ xuống lúc này là rút lại lời mời ngay khi xưởng vừa bấm.
    if (current === 'QC_PENDING' && acc.availableKg > 0) return null
    // Hết phần chờ nghiệm thu mà lệnh chưa xong → xưởng làm tiếp, báo tiếp rồi mời đợt sau.
    return 'IN_PROGRESS'
  }
  return null
}

/**
 * So lại ITP ↔ WO cho một loạt lệnh và sửa những cái lệch.
 * Chỉ ghi khi thật sự lệch nên gọi trong luồng đọc danh sách cũng không tốn thêm gì.
 */
export async function reconcileWorkOrdersQc(woIds: string[], actorId?: string): Promise<WoQcSyncResult[]> {
  if (woIds.length === 0) return []

  const wos = await prisma.workOrder.findMany({
    where: { id: { in: woIds }, status: { in: OPEN_STATUSES } },
    select: { id: true, woCode: true, status: true },
  })
  if (wos.length === 0) return []

  const accMap = await getWoAcceptance(wos.map(w => w.id))

  const changed: WoQcSyncResult[] = []
  for (const wo of wos) {
    const want = verdictFrom(accMap.get(wo.id), wo.status)
    if (!want || want === wo.status) continue

    if (want === 'QC_PENDING' || want === 'IN_PROGRESS') {
      await prisma.workOrder.update({ where: { id: wo.id }, data: { status: want } })
    } else if (want === 'QC_PASSED') {
      // Hai chữ ký không xoá được các ràng buộc QC khác (NDT lỗi, NCR chưa đóng…).
      const gate = await isWorkOrderQcPassed(wo.id, { ignoreReQcFlag: true })
      if (!gate.passed) continue
      await prisma.workOrder.update({
        where: { id: wo.id },
        data: { status: 'QC_PASSED', needsReQc: false, reQcReason: null },
      })
    } else {
      await prisma.workOrder.update({ where: { id: wo.id }, data: { status: 'QC_FAILED' } })
    }

    await logAudit(actorId || 'system', 'TRANSITION', 'WorkOrder', wo.id,
      { woCode: wo.woCode, from: wo.status, to: want, reason: 'Đồng bộ theo kết quả nghiệm thu ITP' })
    changed.push({ woId: wo.id, woCode: wo.woCode, from: wo.status, to: want })
  }
  return changed
}

/** Đồng bộ cho đúng một WO. Trả về thay đổi nếu có. */
export async function syncWorkOrderQc(woId: string, actorId?: string): Promise<WoQcSyncResult | null> {
  const [r] = await reconcileWorkOrdersQc([woId], actorId)
  return r ?? null
}

/** Đồng bộ mọi WO gắn với một ITP (ITP hiện gắn 1 WO, viết dạng nhiều cho chắc). */
export async function syncWorkOrdersOfItp(itpId: string, actorId?: string): Promise<WoQcSyncResult[]> {
  const itp = await prisma.inspectionTestPlan.findUnique({
    where: { id: itpId },
    select: { workOrderId: true },
  })
  if (!itp?.workOrderId) return []
  return reconcileWorkOrdersQc([itp.workOrderId], actorId)
}
