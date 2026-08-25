import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v ?? 0)
// Mời QC / ghi nghiệm thu: QC (R09) + Kho (R05) + Thương mại (R07) + BGĐ/Admin.
const CAN = ['R01', 'R05', 'R05a', 'R07', 'R07a', 'R09', 'R09a', 'R10']

/**
 * POST /api/purchase-contracts/[id]/qc — B9: Mời QC nghiệm thu + ghi kết quả nghiệm thu.
 * body.action:
 *  - 'invite': set qcInvitationDate = hôm nay (mời QC cho HĐ).
 *  - 'inspect': tạo ContractInspection cho 1 dòng HĐ { contractItemId, result, acceptedQty?, acceptedWeight?, reportNo?, remarks? }.
 *      result: 'PASS' | 'FAIL' | 'PARTIAL' (đạt / không đạt / một phần).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền thao tác QC', 403)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as {
      action?: string; contractItemId?: string; result?: string
      acceptedQty?: number | string; acceptedWeight?: number | string; reportNo?: string; remarks?: string
    }
    const action = String(body.action || '')

    const contract = await prisma.purchaseContract.findUnique({ where: { id }, select: { id: true, contractCode: true, tradeType: true, qcInvitationDate: true } })
    if (!contract) return errorResponse('Không tìm thấy hợp đồng', 404)

    if (action === 'invite') {
      await prisma.purchaseContract.update({ where: { id }, data: { qcInvitationDate: contract.qcInvitationDate || new Date() } })
      await logAudit(user.userId, 'CONTRACT_QC_INVITE', 'PurchaseContract', id, { contractCode: contract.contractCode }, getClientIP(req))
      return successResponse({ id, qcInvitationDate: contract.qcInvitationDate || new Date() }, 'Đã mời QC nghiệm thu')
    }

    if (action === 'inspect') {
      const contractItemId = String(body.contractItemId || '')
      if (!contractItemId) return errorResponse('Thiếu contractItemId', 400)
      const result = String(body.result || 'PASS').toUpperCase()
      if (!['PASS', 'FAIL', 'PARTIAL'].includes(result)) return errorResponse('result phải là PASS | FAIL | PARTIAL', 400)
      // Dòng phải thuộc HĐ này.
      const item = await prisma.purchaseContractItem.findFirst({
        where: { id: contractItemId, contractId: id },
        select: { id: true, contractQty: true, deliveredQty: true, contractWeight: true, deliveredWeight: true },
      })
      if (!item) return errorResponse('Dòng nghiệm thu không thuộc hợp đồng này', 404)
      // acceptedQty mặc định = đã giao (else theo HĐ) khi PASS; 0 khi FAIL.
      const defQty = N(item.deliveredQty) > 0 ? N(item.deliveredQty) : N(item.contractQty)
      const defWeight = N(item.deliveredWeight) > 0 ? N(item.deliveredWeight) : N(item.contractWeight)
      const acceptedQty = body.acceptedQty != null ? N(body.acceptedQty) : (result === 'FAIL' ? 0 : defQty)
      const acceptedWeight = body.acceptedWeight != null ? N(body.acceptedWeight) : (result === 'FAIL' ? 0 : defWeight)
      const insp = await prisma.contractInspection.create({
        data: {
          contractItemId, inspectionType: contract.tradeType === 'IMPORT' ? 'IMPORT' : 'DOMESTIC',
          reportNo: body.reportNo ? String(body.reportNo).trim() : null,
          inspectionDate: new Date(), inspectedQty: defQty, acceptedQty, acceptedWeight,
          result, remarks: body.remarks ? String(body.remarks).trim() : null,
        },
        select: { id: true },
      })
      // Dòng đạt/1 phần → cập nhật deliveredQty tối thiểu = acceptedQty (nếu chưa ghi giao).
      await logAudit(user.userId, 'CONTRACT_QC_INSPECT', 'PurchaseContract', id, { contractCode: contract.contractCode, contractItemId, result, acceptedQty }, getClientIP(req))
      return successResponse({ inspectionId: insp.id, result, acceptedQty }, `Đã ghi nghiệm thu: ${result === 'PASS' ? 'Đạt' : result === 'FAIL' ? 'Không đạt' : 'Một phần'}`)
    }

    return errorResponse('action không hợp lệ (invite | inspect)', 400)
  } catch (err) {
    console.error('POST contract qc error:', err)
    return errorResponse('Lỗi thao tác QC', 500)
  }
}
