import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v || 0)
// Lập phiếu đề nghị thanh toán: Thương mại (R07) + PM (R02) + BGĐ/Admin.
const CREATE_ROLES = ['R01', 'R02', 'R02a', 'R07', 'R07a', 'R10']

// GET /api/procurement/payment-requests?projectId=&status=
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const sp = req.nextUrl.searchParams
    const projectId = sp.get('projectId') || undefined
    const status = sp.get('status') || undefined
    const rows = await prisma.paymentRequest.findMany({
      where: { ...(projectId ? { projectId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' }, take: 300,
      select: {
        id: true, code: true, amount: true, currency: true, description: true, status: true,
        hasDocContract: true, hasDocInvoice: true, hasDocVendorReq: true, hasDocHandover: true,
        qldaAt: true, tmkttAt: true, gddaAt: true, rejectReason: true, paidAt: true, createdAt: true,
        vendor: { select: { name: true } }, project: { select: { projectCode: true } }, contract: { select: { contractCode: true } },
      },
    })
    const data = rows.map(r => ({
      id: r.id, code: r.code, amount: N(r.amount), currency: r.currency, description: r.description, status: r.status,
      docs: { contract: r.hasDocContract, invoice: r.hasDocInvoice, vendorReq: r.hasDocVendorReq, handover: r.hasDocHandover },
      approval: { qldaAt: r.qldaAt, tmkttAt: r.tmkttAt, gddaAt: r.gddaAt, rejectReason: r.rejectReason, paidAt: r.paidAt },
      vendorName: r.vendor?.name || '', projectCode: r.project?.projectCode || null, contractCode: r.contract?.contractCode || null,
      createdAt: r.createdAt,
    }))
    const kpi = { total: data.length, pending: data.filter(d => d.status === 'PENDING').length, approved: data.filter(d => d.status === 'APPROVED').length, paid: data.filter(d => d.status === 'PAID').length }
    return successResponse({ paymentRequests: data, kpi })
  } catch (err) {
    console.error('GET payment-requests error:', err)
    return errorResponse('Lỗi tải đề nghị thanh toán', 500)
  }
}

// POST — tạo phiếu đề nghị thanh toán.
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CREATE_ROLES)) return errorResponse('Không có quyền lập đề nghị thanh toán', 403)
    const b = await req.json().catch(() => ({})) as { vendorId?: string; projectId?: string; contractId?: string; amount?: number | string; currency?: string; description?: string }
    // Chọn HĐ → tự kéo NCC / số tiền / dự án / loại tiền từ hợp đồng (đỡ nhập tay).
    let ct: { id: string; vendorId: string; projectId: string | null; value: unknown; currency: string; contractCode: string; signedFileId: string | null } | null = null
    if (b.contractId) {
      ct = await prisma.purchaseContract.findUnique({ where: { id: b.contractId }, select: { id: true, vendorId: true, projectId: true, value: true, currency: true, contractCode: true, signedFileId: true } })
      if (!ct) return errorResponse('Không tìm thấy hợp đồng', 404)
    }
    const vendorId = b.vendorId || ct?.vendorId
    if (!vendorId) return errorResponse('Thiếu nhà cung cấp', 400)
    const amount = N(b.amount) > 0 ? N(b.amount) : N(ct?.value)
    if (!(amount > 0)) return errorResponse('Số tiền phải > 0', 400)
    const count = await prisma.paymentRequest.count()
    const code = `DNTT-${new Date().getFullYear().toString().slice(2)}-${String(count + 1).padStart(4, '0')}`
    // Nếu HĐ đã có file bản ký → coi như đã đủ chứng từ "hợp đồng" ngay khi lập.
    const contractHasFile = !!ct?.signedFileId
    const pr = await prisma.paymentRequest.create({
      data: {
        code, vendorId, projectId: b.projectId || ct?.projectId || null, contractId: ct?.id || null,
        amount, currency: b.currency || ct?.currency || 'VND', description: b.description || null, status: 'DRAFT',
        hasDocContract: contractHasFile, hasDocInvoice: false, hasDocVendorReq: false, hasDocHandover: false,
        createdBy: user.userId,
      },
      select: { id: true, code: true },
    })
    // Đính kèm luôn file HĐ đã ký vào phiếu (nhóm chứng từ "contract") để đi cùng sang Kế toán.
    if (ct?.signedFileId) {
      const src = await prisma.fileAttachment.findUnique({ where: { id: ct.signedFileId }, select: { fileName: true, fileUrl: true, fileSize: true, mimeType: true } })
      if (src) {
        await prisma.fileAttachment.create({ data: { entityType: 'PaymentRequest', entityId: `${pr.id}_contract`, fileName: src.fileName, fileUrl: src.fileUrl, fileSize: src.fileSize, mimeType: src.mimeType, uploadedBy: user.userId } })
      }
    }
    await logAudit(user.userId, 'CREATE', 'PaymentRequest', pr.id, { code: pr.code, amount, contractCode: ct?.contractCode }, getClientIP(req))
    return successResponse({ id: pr.id, code: pr.code }, `Đã tạo đề nghị thanh toán ${pr.code}`, 201)
  } catch (err) {
    console.error('POST payment-requests error:', err)
    return errorResponse('Lỗi tạo đề nghị thanh toán', 500)
  }
}
