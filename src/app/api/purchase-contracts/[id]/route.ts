import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import {
  authenticateRequest,
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  logAudit,
  getClientIP,
} from '@/lib/auth'
import {
  CONTRACT_WRITE_ROLES,
  CONTRACT_TYPES,
  CONTRACT_STATUSES,
  MAX_STR,
} from '@/lib/purchase-contract-constants'

// T1 — PATCH /api/purchase-contracts/[id] — cập nhật trạng thái / điều khoản / file ký

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!CONTRACT_WRITE_ROLES.has(user.roleCode)) {
      return forbiddenResponse('Chỉ Thương mại (R07) / BGĐ (R01) được sửa hợp đồng mua')
    }

    const { id } = await params
    if (!id) return errorResponse('Thiếu mã hợp đồng', 400)

    const existing = await prisma.purchaseContract.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return errorResponse('Hợp đồng không tồn tại', 404)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return errorResponse('Dữ liệu không hợp lệ', 400)

    const data: Record<string, unknown> = {}

    if (body.title != null) {
      const title = String(body.title).trim()
      if (!title) return errorResponse('Tiêu đề không được rỗng', 400)
      if (title.length > MAX_STR) return errorResponse('Nội dung quá dài', 400)
      data.title = title
    }
    if (body.contractType != null) {
      const t = String(body.contractType).trim()
      if (!CONTRACT_TYPES.has(t)) return errorResponse(`Loại hợp đồng không hợp lệ. Chấp nhận: ${[...CONTRACT_TYPES].join(', ')}`, 400)
      data.contractType = t
    }
    if (body.status != null) {
      const s = String(body.status).trim()
      if (!CONTRACT_STATUSES.has(s)) return errorResponse(`Trạng thái không hợp lệ. Chấp nhận: ${[...CONTRACT_STATUSES].join(', ')}`, 400)
      data.status = s
    }
    if (body.value !== undefined) {
      if (body.value === null || body.value === '') {
        data.value = null
      } else {
        const v = Number(body.value)
        if (!Number.isFinite(v) || v < 0) return errorResponse('Giá trị hợp đồng không hợp lệ', 400)
        data.value = v
      }
    }
    if (body.currency != null) data.currency = String(body.currency).trim() || 'VND'
    if (body.paymentTerms !== undefined) data.paymentTerms = body.paymentTerms ? String(body.paymentTerms).trim() : null
    if (body.deliveryTerms !== undefined) data.deliveryTerms = body.deliveryTerms ? String(body.deliveryTerms).trim() : null
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null

    if (body.signedDate !== undefined) {
      if (!body.signedDate) data.signedDate = null
      else {
        const d = new Date(String(body.signedDate))
        if (isNaN(d.getTime())) return errorResponse('Ngày ký không hợp lệ', 400)
        data.signedDate = d
      }
    }
    if (body.effectiveDate !== undefined) {
      if (!body.effectiveDate) data.effectiveDate = null
      else {
        const d = new Date(String(body.effectiveDate))
        if (isNaN(d.getTime())) return errorResponse('Ngày hiệu lực không hợp lệ', 400)
        data.effectiveDate = d
      }
    }
    if (body.signedFileId !== undefined) {
      if (!body.signedFileId) {
        data.signedFileId = null
      } else {
        const fid = String(body.signedFileId).trim()
        const att = await prisma.fileAttachment.findUnique({ where: { id: fid }, select: { id: true } })
        if (!att) return errorResponse('File ký đính kèm không tồn tại', 400)
        data.signedFileId = fid
      }
    }

    if (Object.keys(data).length === 0) return errorResponse('Không có trường nào để cập nhật', 400)

    const contract = await prisma.purchaseContract.update({ where: { id }, data })

    await logAudit(user.userId, 'UPDATE', 'PurchaseContract', id, data, getClientIP(req))

    return successResponse({ contract }, 'Đã cập nhật hợp đồng mua')
  } catch (err) {
    console.error('PATCH /api/purchase-contracts/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
