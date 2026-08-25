import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { PT_SLOT_ROLES, PT_SLOT_LABEL, PT_SUBMIT_ROLES, type PtSlot } from '@/lib/purchase-contract-constants'

export const dynamic = 'force-dynamic'

/**
 * POST /api/purchase-contracts/[id]/payment-approval
 * B7 — Duyệt điều kiện thanh toán HĐ (khớp flow TM): 3 chữ ký Kế toán (R08) + Trưởng KTKT/Mr Sâm (R03) + BGĐ (R01).
 * body.action: 'submit' | 'approve' | 'reject'
 *  - submit: TM/BGĐ đưa HĐ (đã nhập điều kiện TT) vào trình duyệt → DRAFT/REJECTED → PENDING (xoá chữ ký cũ).
 *  - approve: người ký theo role của mình → set chốt tương ứng; đủ 3 chốt → APPROVED + HĐ status=ACTIVE.
 *  - reject: bất kỳ người ký nào → REJECTED + lý do; xoá 3 chữ ký.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { action?: string; note?: string; reason?: string }
    const action = String(body.action || '')

    const c = await prisma.purchaseContract.findUnique({
      where: { id },
      select: {
        id: true, contractCode: true, paymentTerms: true, status: true, paymentTermsStatus: true,
        ptFinanceBy: true, ptKtktBy: true, ptBodBy: true,
      },
    })
    if (!c) return errorResponse('Không tìm thấy hợp đồng', 404)

    // ── SUBMIT: đưa vào trình duyệt ──
    if (action === 'submit') {
      if (!PT_SUBMIT_ROLES.has(payload.roleCode)) return errorResponse('Không có quyền trình duyệt điều kiện thanh toán', 403)
      if (!c.paymentTerms || !c.paymentTerms.trim()) return errorResponse('Chưa nhập điều kiện thanh toán — nhập trước khi trình duyệt', 400)
      if (c.paymentTermsStatus === 'APPROVED') return errorResponse('Điều kiện thanh toán đã được duyệt', 409)
      await prisma.purchaseContract.update({
        where: { id },
        data: {
          paymentTermsStatus: 'PENDING',
          ptFinanceBy: null, ptFinanceAt: null, ptKtktBy: null, ptKtktAt: null, ptBodBy: null, ptBodAt: null,
          ptRejectBy: null, ptRejectAt: null, ptRejectReason: null,
        },
      })
      await logAudit(payload.userId, 'CONTRACT_PT_SUBMIT', 'PurchaseContract', id, { contractCode: c.contractCode }, getClientIP(req))
      return successResponse({ id, paymentTermsStatus: 'PENDING' }, 'Đã trình duyệt điều kiện thanh toán')
    }

    // ── APPROVE / REJECT: chỉ khi đang PENDING ──
    if (action === 'approve' || action === 'reject') {
      if (c.paymentTermsStatus !== 'PENDING') return errorResponse('Điều kiện thanh toán không ở trạng thái chờ duyệt', 409)
      // Xác định chốt của người ký theo role.
      const slot = (Object.keys(PT_SLOT_ROLES) as PtSlot[]).find(s => PT_SLOT_ROLES[s].includes(payload.roleCode))
      if (!slot) return errorResponse('Vai trò của bạn không nằm trong 3 chốt ký (Kế toán / Trưởng KTKT / BGĐ)', 403)

      if (action === 'reject') {
        const reason = String(body.reason || body.note || '').trim()
        if (!reason) return errorResponse('Cần nhập lý do từ chối', 400)
        await prisma.purchaseContract.update({
          where: { id },
          data: {
            paymentTermsStatus: 'REJECTED', ptRejectBy: payload.userId, ptRejectAt: new Date(), ptRejectReason: reason,
            ptFinanceBy: null, ptFinanceAt: null, ptKtktBy: null, ptKtktAt: null, ptBodBy: null, ptBodAt: null,
          },
        })
        await logAudit(payload.userId, 'CONTRACT_PT_REJECT', 'PurchaseContract', id, { contractCode: c.contractCode, slot, reason }, getClientIP(req))
        return successResponse({ id, paymentTermsStatus: 'REJECTED' }, `Đã từ chối điều kiện thanh toán (${PT_SLOT_LABEL[slot]})`)
      }

      // approve: set chốt tương ứng (idempotent — ký lại vẫn của mình)
      const setField: Record<string, unknown> = {}
      if (slot === 'finance') { setField.ptFinanceBy = payload.userId; setField.ptFinanceAt = new Date() }
      if (slot === 'ktkt') { setField.ptKtktBy = payload.userId; setField.ptKtktAt = new Date() }
      if (slot === 'bod') { setField.ptBodBy = payload.userId; setField.ptBodAt = new Date() }

      // Tính đủ 3 chốt sau khi set (kết hợp giá trị hiện có + vừa ký).
      const financeOk = slot === 'finance' || !!c.ptFinanceBy
      const ktktOk = slot === 'ktkt' || !!c.ptKtktBy
      const bodOk = slot === 'bod' || !!c.ptBodBy
      const allSigned = financeOk && ktktOk && bodOk
      if (allSigned) {
        setField.paymentTermsStatus = 'APPROVED'
        setField.status = 'ACTIVE' // đủ 3 chữ ký → HĐ hiệu lực
      }
      await prisma.purchaseContract.update({ where: { id }, data: setField })
      await logAudit(payload.userId, allSigned ? 'CONTRACT_PT_APPROVED_FULL' : 'CONTRACT_PT_APPROVE', 'PurchaseContract', id, { contractCode: c.contractCode, slot, allSigned }, getClientIP(req))
      return successResponse(
        { id, paymentTermsStatus: allSigned ? 'APPROVED' : 'PENDING', slot },
        allSigned ? 'Đã đủ 3 chữ ký — điều kiện thanh toán được duyệt, HĐ hiệu lực' : `Đã ký duyệt (${PT_SLOT_LABEL[slot]})`,
      )
    }

    return errorResponse('action không hợp lệ (submit | approve | reject)', 400)
  } catch (err) {
    console.error('POST payment-approval error:', err)
    return errorResponse('Lỗi duyệt điều kiện thanh toán', 500)
  }
}
