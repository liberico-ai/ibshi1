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
    const b = await req.json().catch(() => ({})) as { vendorId?: string; projectId?: string; contractId?: string; amount?: number | string; currency?: string; description?: string; docs?: { contract?: boolean; invoice?: boolean; vendorReq?: boolean; handover?: boolean } }
    if (!b.vendorId) return errorResponse('Thiếu nhà cung cấp', 400)
    const amount = N(b.amount)
    if (!(amount > 0)) return errorResponse('Số tiền phải > 0', 400)
    const count = await prisma.paymentRequest.count()
    const code = `DNTT-${new Date().getFullYear().toString().slice(2)}-${String(count + 1).padStart(4, '0')}`
    const pr = await prisma.paymentRequest.create({
      data: {
        code, vendorId: b.vendorId, projectId: b.projectId || null, contractId: b.contractId || null,
        amount, currency: b.currency || 'VND', description: b.description || null, status: 'DRAFT',
        hasDocContract: !!b.docs?.contract, hasDocInvoice: !!b.docs?.invoice, hasDocVendorReq: !!b.docs?.vendorReq, hasDocHandover: !!b.docs?.handover,
        createdBy: user.userId,
      },
      select: { id: true, code: true },
    })
    await logAudit(user.userId, 'CREATE', 'PaymentRequest', pr.id, { code: pr.code, amount }, getClientIP(req))
    return successResponse({ id: pr.id, code: pr.code }, `Đã tạo đề nghị thanh toán ${pr.code}`, 201)
  } catch (err) {
    console.error('POST payment-requests error:', err)
    return errorResponse('Lỗi tạo đề nghị thanh toán', 500)
  }
}
