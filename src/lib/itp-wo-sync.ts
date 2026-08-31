import prisma from './db'
import { isWorkOrderQcPassed } from './qc-gate'
import { logAudit } from './auth'

// ─────────────────────────────────────────────────────────────────────────────
// Đồng bộ kết quả nghiệm thu ITP → trạng thái QC của lệnh sản xuất.
//
// Màn WO không còn nút "QC Đạt / Không đạt": kết quả do màn Kế hoạch Kiểm tra quyết định.
// Vì vậy việc đồng bộ KHÔNG được phụ thuộc vào đúng một lần bấm — nếu lần đó lỗi mạng,
// hoặc ITP đã đạt từ trước khi có luật này, thì WO kẹt ở "Chờ QC" vĩnh viễn mà không có
// đường gỡ. Hàm dưới đây tự so lại và tự sửa, gọi bao nhiêu lần cũng cho cùng kết quả.
// ─────────────────────────────────────────────────────────────────────────────

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'QC_PENDING', 'QC_FAILED', 'ON_HOLD', 'PENDING_MATERIAL']

export interface WoQcSyncResult {
  woId: string
  woCode: string
  from: string
  to: string
}

/**
 * Trạng thái QC mà ITP đang chỉ định cho một WO:
 *   • có điểm kiểm FAILED  → QC_FAILED
 *   • mọi ITP đã COMPLETED → QC_PASSED
 *   • còn lại              → null (không đụng vào WO)
 */
function verdictFrom(itps: { status: string; checkpoints: { status: string }[] }[]): 'QC_PASSED' | 'QC_FAILED' | null {
  if (itps.length === 0) return null
  const cps = itps.flatMap(i => i.checkpoints)
  if (cps.length === 0) return null
  if (cps.some(c => c.status === 'FAILED')) return 'QC_FAILED'
  if (cps.every(c => c.status === 'PASSED')) return 'QC_PASSED'
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

  const itps = await prisma.inspectionTestPlan.findMany({
    where: { workOrderId: { in: wos.map(w => w.id) } },
    select: { workOrderId: true, status: true, checkpoints: { select: { status: true } } },
  })

  const byWo = new Map<string, { status: string; checkpoints: { status: string }[] }[]>()
  for (const i of itps) {
    if (!i.workOrderId) continue
    const arr = byWo.get(i.workOrderId) || []
    arr.push({ status: i.status, checkpoints: i.checkpoints })
    byWo.set(i.workOrderId, arr)
  }

  const changed: WoQcSyncResult[] = []
  for (const wo of wos) {
    const want = verdictFrom(byWo.get(wo.id) || [])
    if (!want || want === wo.status) continue

    if (want === 'QC_PASSED') {
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
