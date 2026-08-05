import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createGrnSchema } from '@/lib/schemas'
import { recalcBudgetActual } from '@/lib/sync-engine'
import { generateMaterialCode } from '@/lib/material-code'
import { detectPrefixSubgroup } from '@/lib/bompr-enrich'

// GET /api/grn — List goods received (stock movements with type=IN, reason=po_receipt)
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const poCode = url.searchParams.get('poCode') || undefined

  // Lịch sử "hàng về" = các bản ghi RECEIPT (cả chờ nhập kho lẫn đã nhập)
  const where: Record<string, unknown> = {
    type: 'RECEIPT',
  }

  if (poCode) {
    where.referenceNo = { contains: poCode }
  }

  const [total, movements] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: {
        material: { select: { materialCode: true, name: true, unit: true } },
        millCertificate: { select: { certNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ])

  return successResponse({
    receipts: movements.map((m: Record<string, unknown> & { millCertificate: { certNumber: string } | null }) => ({
      ...m,
      millCert: m.millCertificate?.certNumber || null,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

// POST /api/grn — Receive goods against a PO
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R02', 'R02a', 'R05', 'R05a', 'R07', 'R07a', 'R08', 'R08a'])) {
    return errorResponse('Không có quyền nhận hàng', 403)
  }

  const validation = await validateBody(req, createGrnSchema)
  if (!validation.success) return validation.response
  const { poId, items } = validation.data

  // Validate PO exists and is in receivable state
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { items: { include: { material: true } } },
  })

  if (!po) return errorResponse('Không tìm thấy PO')
  // PO-Gate: chỉ nhận hàng với PO đã được duyệt (APPROVED trở đi).
  // PENDING/DRAFT/REJECTED/CANCELLED → 422, chờ R01/R07 duyệt qua /api/purchase-orders/[id]/approve.
  if (['CANCELLED', 'DRAFT', 'PENDING', 'REJECTED'].includes(po.status)) {
    return errorResponse(`PO ${po.poCode} chưa được duyệt hoặc đã hủy (trạng thái: ${po.status}) — không thể nhận hàng`, 422)
  }

  // BẮT BUỘC Heat No + Lot No cho vật tư KHÔNG phải tiêu hao (category = 'consumable' được miễn).
  const missingCert: string[] = []
  for (const it of items) {
    if (it.receivedQty <= 0) continue
    const poItem = po.items.find(i => i.id === it.poItemId)
    if (!poItem) continue
    const isConsumable = (poItem.material?.category || '').toLowerCase() === 'consumable'
    if (!isConsumable && (!it.heatNumber?.trim() || !it.lotNumber?.trim())) {
      missingCert.push(poItem.material?.name || poItem.description || poItem.itemCode || it.poItemId)
    }
  }
  if (missingCert.length > 0) {
    return errorResponse(`Cần nhập Heat No + Lot No cho vật tư (trừ tiêu hao): ${missingCert.join(', ')}`, 422)
  }

  // BẮT BUỘC đính kèm hồ sơ (hợp đồng / Mill Cert / chứng chỉ) nếu có vật tư không phải tiêu hao.
  // File upload trước qua /api/upload với entityType='GRN', entityId=poId.
  const hasNonConsumable = items.some(it => {
    if (it.receivedQty <= 0) return false
    const poItem = po.items.find(i => i.id === it.poItemId)
    return poItem && (poItem.material?.category || '').toLowerCase() !== 'consumable'
  })
  if (hasNonConsumable) {
    const docCount = await prisma.fileAttachment.count({ where: { entityType: 'GRN', entityId: po.id } })
    if (docCount === 0) {
      return errorResponse('Bắt buộc đính kèm hồ sơ Heat/Lot/Mill Cert (hợp đồng / chứng chỉ chất lượng) trước khi nhận hàng (trừ vật tư tiêu hao)', 422)
    }
  }

  // Process each item in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const movements = []

    for (const item of items) {
      const poItem = po.items.find(i => i.id === item.poItemId)
      if (!poItem) continue
      if (item.receivedQty <= 0) continue

      const newReceivedQty = Number(poItem.receivedQty) + item.receivedQty

      // Update PO item received qty
      await tx.purchaseOrderItem.update({
        where: { id: item.poItemId },
        data: { receivedQty: newReceivedQty },
      })

      let materialId = poItem.materialId

      if (!materialId) {
        const snapshot = {
          description: poItem.description || '',
          profile: poItem.profile || '',
        }
        const { prefix, subgroup } = detectPrefixSubgroup(snapshot)
        const code = await generateMaterialCode(tx, prefix, subgroup)
        const mat = await tx.material.create({
          data: {
            materialCode: code,
            name: (snapshot.description || snapshot.profile || 'Vật tư tạm').trim(),
            unit: poItem.unit || 'cái',
            category: prefix,
            specification: snapshot.profile || undefined,
            grade: poItem.grade || undefined,
            status: 'PENDING',
            isProvisional: true,
            createdByUnit: 'GRN',
          },
        })
        materialId = mat.id
        await tx.purchaseOrderItem.update({
          where: { id: item.poItemId },
          data: { materialId: mat.id },
        })
      }

      // Mill Certificate: ưu tiên cert do người dùng chọn; nếu chỉ có heat number
      // thì tự tìm cert khớp heatNumber + vendor của PO (không tự tạo cert mới)
      let millCertificateId: string | null = item.millCertificateId || null
      if (millCertificateId) {
        const cert = await tx.millCertificate.findUnique({ where: { id: millCertificateId } })
        if (!cert) millCertificateId = null
      } else if (item.heatNumber) {
        const cert = await tx.millCertificate.findFirst({
          where: { heatNumber: item.heatNumber, vendorId: po.vendorId },
          orderBy: { createdAt: 'desc' },
        })
        if (cert) millCertificateId = cert.id
      }

      // Bản ghi "hàng về" (RECEIPT) — LOG-ONLY, KHÔNG cộng tồn kho.
      // Việc cộng tồn thực hiện ở bước Kho "Nhập hàng (GRN)" sau khi QC nghiệm thu Đạt.
      // reason='po_receipt' = chờ nhập kho; sẽ đổi 'po_receipt_stocked' khi Kho đã nhập.
      const movement = await tx.stockMovement.create({
        data: {
          materialId,
          type: 'RECEIPT',
          quantity: item.receivedQty,
          reason: 'po_receipt',
          referenceNo: po.poCode,
          poItemId: item.poItemId,
          heatNumber: item.heatNumber || null,
          lotNumber: item.lotNumber || null,
          millCertificateId,
          performedBy: user.userId,
          notes: item.notes || `Hàng về từ ${po.poCode}`,
        },
      })
      movements.push(movement)
    }

    // Check if all PO items are fully received
    const updatedPO = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    })

    const allReceived = updatedPO!.items.every(i => Number(i.receivedQty) >= Number(i.quantity))
    const someReceived = updatedPO!.items.some(i => Number(i.receivedQty) > 0)

    const newStatus = allReceived ? 'RECEIVED' : someReceived ? 'PARTIAL_RECEIVED' : po.status

    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: newStatus },
    })

    return { movements, poStatus: newStatus }
  })

  if (result.movements.length > 0 && po.projectId) {
    try { await recalcBudgetActual(po.projectId, user.userId) }
    catch (e) { console.error('[GRN] recalcBudgetActual error:', e) }
  }

  // Báo QAQC (R09 + R09a) rằng hàng đã về → hiện ở chuông thông báo để QC vào nghiệm thu.
  if (result.movements.length > 0) {
    try {
      const qcUsers = await prisma.user.findMany({
        where: { roleCode: { in: ['R09', 'R09a'] }, isActive: true },
        select: { id: true },
      })
      if (qcUsers.length) {
        await prisma.notification.createMany({
          data: qcUsers.map((u) => ({
            userId: u.id,
            title: 'Hàng đã về — cần nghiệm thu',
            message: `Đơn hàng ${po.poCode} đã về. Vào QC → Nghiệm thu vật tư để kiểm tra chất lượng.`,
            type: 'goods_received',
            linkUrl: '/dashboard/qc/inspections',
          })),
        })
      }
    } catch (e) {
      console.error('[GRN] notify QC error:', e)
    }
  }

  // Sinh task "THÔNG BÁO" P4.3 (QAQC nghiệm thu chất lượng hàng về) cho QC — 1 lần / PO.
  // Đây chỉ là con trỏ sang tab Chất lượng; mở lần đầu sẽ tự đánh dấu đã đọc, KHÔNG thao
  // tác/hoàn thành ở Công việc. Gán theo role R09/R09a (userId=null → mọi user QC đều thấy).
  if (result.movements.length > 0) {
    try {
      const existed = await prisma.task.findFirst({
        where: { taskType: 'P4.3', resultData: { path: ['poId'], equals: po.id } },
        select: { id: true },
      })
      if (!existed) {
        const t = await prisma.task.create({
          data: {
            projectId: po.projectId || null,
            level: 2,
            taskType: 'P4.3',
            title: `QAQC nghiệm thu chất lượng hàng về — ${po.poCode}`,
            description: `Đơn hàng ${po.poCode} đã về. Mở tab Chất lượng để nghiệm thu chất lượng vật tư.`,
            priority: 'HIGH',
            createdBy: user.userId,
            assignedAt: new Date(),
            status: 'OPEN',
            resultData: { poId: po.id, poCode: po.poCode, notify: true },
          },
        })
        await prisma.taskAssignee.createMany({
          data: [
            { taskId: t.id, role: 'R09', userId: null, isPrimary: true },
            { taskId: t.id, role: 'R09a', userId: null, isPrimary: false },
          ],
        })
        await prisma.taskHistory.create({ data: { taskId: t.id, action: 'CREATED', byUserId: user.userId } })
      }
    } catch (e) {
      console.error('[GRN] spawn P4.3 notify task error:', e)
    }
  }

  return successResponse({
    message: `Đã nhận ${result.movements.length} mục`,
    movements: result.movements,
    poStatus: result.poStatus,
  })
}
