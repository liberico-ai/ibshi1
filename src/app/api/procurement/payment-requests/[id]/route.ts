import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
// 3 chốt ký (QT19 bước 11): QLDA kiểm → TP.TM/Kế toán trưởng soát → GĐ dự án duyệt.
const SLOT_ROLES: Record<string, string[]> = { qlda: ['R02', 'R02a'], tmktt: ['R07', 'R07a', 'R08'], gdda: ['R01'] }
const SLOT_LABEL: Record<string, string> = { qlda: 'QLDA', tmktt: 'TP.TM / Kế toán trưởng', gdda: 'GĐ dự án' }
const SUBMIT_ROLES = ['R01', 'R02', 'R02a', 'R07', 'R07a', 'R10']
const PAY_ROLES = ['R08', 'R08a', 'R01', 'R10']

/**
 * POST /api/procurement/payment-requests/[id] — QT19 bước 11-12.
 * action: submit | approve | reject | pay. approve theo TRÌNH TỰ qlda → tmktt → gdda; đủ 3 → APPROVED.
 * Điều kiện submit: phải đủ 4 chứng từ (hasDoc*). pay: chỉ khi APPROVED.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { action?: string; reason?: string }
    const action = String(body.action || '')
    const p = await prisma.paymentRequest.findUnique({ where: { id }, select: { id: true, code: true, status: true, hasDocContract: true, hasDocInvoice: true, hasDocVendorReq: true, hasDocHandover: true, qldaBy: true, tmkttBy: true, gddaBy: true } })
    if (!p) return errorResponse('Không tìm thấy đề nghị thanh toán', 404)

    if (action === 'submit') {
      if (!SUBMIT_ROLES.includes(user.roleCode)) return errorResponse('Không có quyền trình duyệt', 403)
      if (!(p.hasDocContract && p.hasDocInvoice && p.hasDocVendorReq && p.hasDocHandover)) {
        return errorResponse('Chưa đủ 4 chứng từ (HĐ/báo giá · hoá đơn · YCTT của NCC · biên bản giao có ký) — bổ sung trước khi trình', 400)
      }
      if (p.status === 'APPROVED' || p.status === 'PAID') return errorResponse('Đề nghị đã duyệt/đã trả', 409)
      await prisma.paymentRequest.update({ where: { id }, data: { status: 'PENDING', qldaBy: null, qldaAt: null, tmkttBy: null, tmkttAt: null, gddaBy: null, gddaAt: null, rejectBy: null, rejectAt: null, rejectReason: null } })
      await logAudit(user.userId, 'PAYREQ_SUBMIT', 'PaymentRequest', id, { code: p.code }, getClientIP(req))
      return successResponse({ id, status: 'PENDING' }, 'Đã trình duyệt thanh toán')
    }

    if (action === 'reject') {
      if (p.status !== 'PENDING') return errorResponse('Chỉ từ chối được khi đang chờ duyệt', 409)
      const slot = Object.keys(SLOT_ROLES).find(s => SLOT_ROLES[s].includes(user.roleCode))
      if (!slot) return errorResponse('Vai trò không nằm trong 3 chốt duyệt', 403)
      const reason = String(body.reason || '').trim()
      if (!reason) return errorResponse('Cần nhập lý do từ chối', 400)
      await prisma.paymentRequest.update({ where: { id }, data: { status: 'REJECTED', rejectBy: user.userId, rejectAt: new Date(), rejectReason: reason, qldaBy: null, qldaAt: null, tmkttBy: null, tmkttAt: null, gddaBy: null, gddaAt: null } })
      await logAudit(user.userId, 'PAYREQ_REJECT', 'PaymentRequest', id, { code: p.code, slot, reason }, getClientIP(req))
      return successResponse({ id, status: 'REJECTED' }, `Đã từ chối (${SLOT_LABEL[slot]})`)
    }

    if (action === 'approve') {
      if (p.status !== 'PENDING') return errorResponse('Đề nghị không ở trạng thái chờ duyệt', 409)
      const slot = Object.keys(SLOT_ROLES).find(s => SLOT_ROLES[s].includes(user.roleCode))
      if (!slot) return errorResponse('Vai trò của bạn không nằm trong 3 chốt (QLDA / TP.TM-KTT / GĐ dự án)', 403)
      // Trình tự: qlda → tmktt → gdda.
      if (slot === 'tmktt' && !p.qldaBy) return errorResponse('Chờ QLDA kiểm trước', 409)
      if (slot === 'gdda' && (!p.qldaBy || !p.tmkttBy)) return errorResponse('Chờ QLDA + TP.TM/KTT ký trước', 409)
      const data: Record<string, unknown> = {}
      if (slot === 'qlda') { data.qldaBy = user.userId; data.qldaAt = new Date() }
      if (slot === 'tmktt') { data.tmkttBy = user.userId; data.tmkttAt = new Date() }
      if (slot === 'gdda') { data.gddaBy = user.userId; data.gddaAt = new Date() }
      const allSigned = (slot === 'gdda') && !!p.qldaBy && !!p.tmkttBy // ký gdda là cuối cùng
      if (allSigned) data.status = 'APPROVED'
      await prisma.paymentRequest.update({ where: { id }, data })
      await logAudit(user.userId, allSigned ? 'PAYREQ_APPROVED_FULL' : 'PAYREQ_APPROVE', 'PaymentRequest', id, { code: p.code, slot }, getClientIP(req))
      return successResponse({ id, status: allSigned ? 'APPROVED' : 'PENDING', slot }, allSigned ? 'Đã đủ 3 chữ ký — duyệt thanh toán' : `Đã ký (${SLOT_LABEL[slot]})`)
    }

    if (action === 'pay') {
      if (!PAY_ROLES.includes(user.roleCode)) return errorResponse('Chỉ Tài chính Kế toán / BGĐ được ghi đã trả', 403)
      if (p.status !== 'APPROVED') return errorResponse('Chỉ thanh toán khi đề nghị đã được duyệt đủ 3 chữ ký', 409)
      await prisma.paymentRequest.update({ where: { id }, data: { status: 'PAID', paidBy: user.userId, paidAt: new Date() } })
      await logAudit(user.userId, 'PAYREQ_PAID', 'PaymentRequest', id, { code: p.code }, getClientIP(req))
      return successResponse({ id, status: 'PAID' }, 'Đã ghi nhận thanh toán')
    }

    return errorResponse('action không hợp lệ (submit | approve | reject | pay)', 400)
  } catch (err) {
    console.error('POST payment-request action error:', err)
    return errorResponse('Lỗi xử lý đề nghị thanh toán', 500)
  }
}
