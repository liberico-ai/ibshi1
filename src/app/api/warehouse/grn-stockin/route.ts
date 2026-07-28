import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { applyStockMovement } from '@/lib/stock-ledger'
import { recalcBudgetActual } from '@/lib/sync-engine'

// Quyền mặc định: chỉ Kho (R05/R05a) + BGĐ (R01). Thêm role khác qua Phân quyền nếu cần.
const ALLOWED_ROLES = ['R01', 'R05', 'R05a']

// Tập poId đã được QC nghiệm thu Đạt (Inspection material_incoming, status=PASSED)
async function getQcPassedPoIds(): Promise<Set<string>> {
  const inspections = await prisma.inspection.findMany({
    where: { type: 'material_incoming', status: 'PASSED' },
    select: { resultData: true },
  })
  const set = new Set<string>()
  for (const insp of inspections) {
    const poIds = (insp.resultData as { poIds?: string[] } | null)?.poIds || []
    for (const id of poIds) set.add(id)
  }
  return set
}

// GET /api/warehouse/grn-stockin — Danh sách PO đã QC Đạt, còn bản ghi "hàng về" chờ nhập kho
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền nhập hàng vào kho', 403)

  const passedPoIds = await getQcPassedPoIds()
  if (passedPoIds.size === 0) return successResponse({ purchaseOrders: [] })

  // PO đã QC Đạt → map poCode → thông tin PO (RECEIPT liên kết PO qua referenceNo = poCode)
  const passedPOs = await prisma.purchaseOrder.findMany({
    where: { id: { in: Array.from(passedPoIds) } },
    select: { id: true, poCode: true, vendor: { select: { name: true } }, project: { select: { projectCode: true } } },
  })
  const poByCode = new Map(passedPOs.map(p => [p.poCode, p]))
  const passedCodes = passedPOs.map(p => p.poCode)
  if (passedCodes.length === 0) return successResponse({ purchaseOrders: [] })

  // Các bản ghi RECEIPT còn chờ nhập kho (reason='po_receipt') thuộc các PO đã QC Đạt
  const receipts = await prisma.stockMovement.findMany({
    where: { type: 'RECEIPT', reason: 'po_receipt', referenceNo: { in: passedCodes } },
    include: {
      material: { select: { materialCode: true, name: true, unit: true } },
      millCertificate: { select: { certNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Gộp theo PO
  const poMap = new Map<string, {
    poId: string; poCode: string; vendorName: string; projectCode: string | null;
    items: Array<{ receiptId: string; poItemId: string | null; materialName: string; unit: string; claimedQty: number; heatNumber: string | null; lotNumber: string | null; millCert: string | null }>
  }>()

  for (const r of receipts) {
    const po = r.referenceNo ? poByCode.get(r.referenceNo) : undefined
    if (!po) continue
    if (!poMap.has(po.id)) {
      poMap.set(po.id, {
        poId: po.id, poCode: po.poCode,
        vendorName: po.vendor?.name || 'N/A',
        projectCode: po.project?.projectCode || null,
        items: [],
      })
    }
    poMap.get(po.id)!.items.push({
      receiptId: r.id,
      poItemId: r.poItemId,
      materialName: r.material ? `${r.material.materialCode} — ${r.material.name}` : '—',
      unit: r.material?.unit || '',
      claimedQty: Number(r.quantity),
      heatNumber: r.heatNumber,
      lotNumber: r.lotNumber,
      millCert: r.millCertificate?.certNumber || null,
    })
  }

  return successResponse({ purchaseOrders: Array.from(poMap.values()) })
}

// POST /api/warehouse/grn-stockin — Kho nhập kho thực tế cho 1 PO đã QC Đạt
// body: { poId, items: [{ receiptId, actualQty, reason? }] }
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Không có quyền nhập hàng vào kho', 403)

  const body = await req.json().catch(() => null)
  const poId: string | undefined = body?.poId
  const items: Array<{ receiptId: string; actualQty: number; reason?: string }> = body?.items || []
  if (!poId || items.length === 0) return errorResponse('Thiếu poId hoặc danh sách vật tư', 400)

  // Kiểm PO đã QC Đạt
  const passedPoIds = await getQcPassedPoIds()
  if (!passedPoIds.has(poId)) return errorResponse('PO chưa được QC nghiệm thu Đạt — không thể nhập kho', 422)

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { items: true },
  })
  if (!po) return errorResponse('Không tìm thấy PO', 404)

  // Tải các bản ghi RECEIPT tương ứng + validate
  const receiptIds = items.map(i => i.receiptId)
  const receipts = await prisma.stockMovement.findMany({
    where: { id: { in: receiptIds }, type: 'RECEIPT', reason: 'po_receipt' },
  })
  const receiptById = new Map(receipts.map(r => [r.id, r]))

  // Validate từng dòng trước khi ghi
  for (const it of items) {
    const r = receiptById.get(it.receiptId)
    if (!r) return errorResponse(`Bản ghi hàng về không hợp lệ hoặc đã nhập kho: ${it.receiptId}`, 422)
    if (r.referenceNo !== po.poCode) return errorResponse('Bản ghi hàng về không thuộc PO này', 422)
    const actual = Number(it.actualQty)
    if (!(actual > 0)) return errorResponse('Số lượng thực nhận phải lớn hơn 0', 422)
    const claimed = Number(r.quantity)
    if (actual !== claimed && !(it.reason && it.reason.trim())) {
      return errorResponse('Số lượng thực nhận lệch so với TM báo — bắt buộc nhập lý do', 422)
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      const r = receiptById.get(it.receiptId)!
      const claimed = Number(r.quantity)
      const actual = Number(it.actualQty)
      const diff = actual - claimed

      // Cộng tồn kho = SL thực nhận (bản ghi IN thật sự)
      const note = diff === 0
        ? (r.notes || `Nhập kho từ ${po.poCode}`)
        : `TM báo ${claimed}, thực nhận ${actual} (${diff > 0 ? 'thừa' : 'thiếu'} ${Math.abs(diff)}). Lý do: ${it.reason?.trim()}`
      await applyStockMovement(tx, {
        materialId: r.materialId,
        type: 'IN',
        quantity: actual,
        reason: 'po_receipt',
        referenceNo: po.poCode,
        poItemId: r.poItemId,
        projectId: po.projectId,
        heatNumber: r.heatNumber,
        lotNumber: r.lotNumber,
        millCertificateId: r.millCertificateId,
        performedBy: user.userId,
        notes: note,
      })

      // Điều chỉnh receivedQty của PO item = SL thực nhận (chênh lệch trả ngược PO)
      if (r.poItemId && diff !== 0) {
        await tx.purchaseOrderItem.update({
          where: { id: r.poItemId },
          data: { receivedQty: { increment: diff } },
        })
      }

      // Đánh dấu bản ghi hàng về đã nhập kho
      await tx.stockMovement.update({
        where: { id: r.id },
        data: { reason: 'po_receipt_stocked' },
      })
    }

    // Tính lại trạng thái PO theo receivedQty mới
    const updated = await tx.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } })
    const allReceived = updated!.items.every(i => Number(i.receivedQty) >= Number(i.quantity))
    const someReceived = updated!.items.some(i => Number(i.receivedQty) > 0)
    const newStatus = allReceived ? 'RECEIVED' : someReceived ? 'PARTIAL_RECEIVED' : po.status
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: newStatus } })
  })

  if (po.projectId) {
    try { await recalcBudgetActual(po.projectId, user.userId) }
    catch (e) { console.error('[GRN-stockin] recalcBudgetActual error:', e) }
  }

  return successResponse({ message: `Đã nhập kho ${items.length} vật tư từ ${po.poCode}` })
}
