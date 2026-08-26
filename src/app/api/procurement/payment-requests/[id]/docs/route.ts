import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { saveAttachmentFromBuffer, validateFileName } from '@/lib/save-attachment'

export const dynamic = 'force-dynamic'

// 4 loại chứng từ đi kèm phiếu thanh toán (QT19 §bước 10) — mỗi loại 1 nhóm file, tự bật cờ hasDoc*.
const DOC_TYPES = ['contract', 'invoice', 'vendorReq', 'handover'] as const
type DocType = typeof DOC_TYPES[number]
const HAS_FIELD: Record<DocType, 'hasDocContract' | 'hasDocInvoice' | 'hasDocVendorReq' | 'hasDocHandover'> = {
  contract: 'hasDocContract', invoice: 'hasDocInvoice', vendorReq: 'hasDocVendorReq', handover: 'hasDocHandover',
}
// Ai lập/sửa phiếu được đính kèm — trùng CREATE_ROLES của payment-requests.
const EDIT_ROLES = ['R01', 'R02', 'R02a', 'R07', 'R07a', 'R10']
const MAX_FILE = 25 * 1024 * 1024
const ENTITY = 'PaymentRequest'
const eid = (id: string, t: DocType) => `${id}_${t}` // entityId theo loại chứng từ

// GET — liệt kê file theo 4 loại (mọi vai trò xem được, để Kế toán mở HĐ/hoá đơn trước khi chi).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const rows = await prisma.fileAttachment.findMany({
      where: { entityType: ENTITY, entityId: { in: DOC_TYPES.map(t => eid(id, t)) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entityId: true, fileName: true, fileUrl: true, mimeType: true, fileSize: true, createdAt: true },
    })
    const byType: Record<string, typeof rows> = { contract: [], invoice: [], vendorReq: [], handover: [] }
    for (const f of rows) { const t = f.entityId.slice(id.length + 1) as DocType; if (byType[t]) byType[t].push(f) }
    return successResponse({ docs: byType })
  } catch (err) {
    console.error('GET payment-request docs error:', err)
    return errorResponse('Lỗi tải chứng từ', 500)
  }
}

// POST (multipart: file, docType) — đính kèm 1 file cho 1 loại chứng từ; tự bật cờ hasDoc*.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền đính kèm chứng từ', 403)
    const { id } = await params
    const pr = await prisma.paymentRequest.findUnique({ where: { id }, select: { id: true, code: true, status: true } })
    if (!pr) return errorResponse('Không tìm thấy phiếu thanh toán', 404)
    if (pr.status === 'APPROVED' || pr.status === 'PAID') return errorResponse('Phiếu đã duyệt/đã trả — không sửa chứng từ', 409)

    const fd = await req.formData()
    const file = fd.get('file') as File | null
    const docType = String(fd.get('docType') || '') as DocType
    if (!DOC_TYPES.includes(docType)) return errorResponse('Loại chứng từ không hợp lệ', 400)
    if (!file) return errorResponse('Chưa chọn file', 400)
    const extErr = validateFileName(file.name)
    if (extErr) return errorResponse(extErr, 400)
    if (file.size > MAX_FILE) return errorResponse('File quá lớn (tối đa 25MB)', 400)

    const buffer = Buffer.from(await file.arrayBuffer())
    const att = await saveAttachmentFromBuffer({ buffer, fileName: file.name, entityType: ENTITY, entityId: eid(id, docType), uploadedBy: user.userId })
    await prisma.paymentRequest.update({ where: { id }, data: { [HAS_FIELD[docType]]: true } })
    await logAudit(user.userId, 'PAYREQ_DOC_ADD', 'PaymentRequest', id, { code: pr.code, docType, fileName: file.name }, getClientIP(req))
    return successResponse({ attachment: att }, 'Đã đính kèm chứng từ', 201)
  } catch (err) {
    console.error('POST payment-request docs error:', err)
    return errorResponse('Lỗi đính kèm chứng từ', 500)
  }
}

// DELETE ?fileId= — gỡ 1 file; nếu loại đó không còn file nào → tắt cờ hasDoc*.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Không có quyền gỡ chứng từ', 403)
    const { id } = await params
    const pr = await prisma.paymentRequest.findUnique({ where: { id }, select: { id: true, code: true, status: true } })
    if (!pr) return errorResponse('Không tìm thấy phiếu thanh toán', 404)
    if (pr.status === 'APPROVED' || pr.status === 'PAID') return errorResponse('Phiếu đã duyệt/đã trả — không sửa chứng từ', 409)
    const fileId = req.nextUrl.searchParams.get('fileId') || ''
    const f = await prisma.fileAttachment.findFirst({ where: { id: fileId, entityType: ENTITY, entityId: { in: DOC_TYPES.map(t => eid(id, t)) } }, select: { id: true, entityId: true } })
    if (!f) return errorResponse('Không tìm thấy file', 404)
    const docType = f.entityId.slice(id.length + 1) as DocType
    await prisma.fileAttachment.delete({ where: { id: f.id } })
    const left = await prisma.fileAttachment.count({ where: { entityType: ENTITY, entityId: eid(id, docType) } })
    if (left === 0 && HAS_FIELD[docType]) await prisma.paymentRequest.update({ where: { id }, data: { [HAS_FIELD[docType]]: false } })
    await logAudit(user.userId, 'PAYREQ_DOC_DEL', 'PaymentRequest', id, { code: pr.code, docType, fileId: f.id }, getClientIP(req))
    return successResponse({ id: f.id }, 'Đã gỡ chứng từ')
  } catch (err) {
    console.error('DELETE payment-request docs error:', err)
    return errorResponse('Lỗi gỡ chứng từ', 500)
  }
}
