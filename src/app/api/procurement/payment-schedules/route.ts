import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R08', 'R08a', 'R10']

const d = (v?: string | null) => (v ? new Date(v) : null)

/** GET /api/procurement/payment-schedules?projectId= — danh sách lịch thanh toán */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined

    const rows = await prisma.paymentSchedule.findMany({
      where: projectId ? { projectId } : {},
      orderBy: [{ status: 'asc' }, { lcDeadline: 'asc' }],
      include: { purchaseOrder: { select: { poCode: true } } },
    })
    return successResponse({
      schedules: rows.map(r => ({
        id: r.id, supplier: r.supplier, saleContract: r.saleContract, value: Number(r.value || 0), currency: r.currency,
        paymentMethod: r.paymentMethod, signDate: r.signDate, lcDate: r.lcDate, etd: r.etd, eta: r.eta,
        documentDate: r.documentDate, lcDeadline: r.lcDeadline, paymentMonth: r.paymentMonth, status: r.status,
        paidDate: r.paidDate, paidAmount: r.paidAmount != null ? Number(r.paidAmount) : null,
        poCode: r.purchaseOrder?.poCode || null, notes: r.notes,
      })),
    })
  } catch (err) {
    console.error('GET payment-schedules error:', err)
    return errorResponse('Lỗi tải lịch thanh toán', 500)
  }
}

/** POST /api/procurement/payment-schedules — tạo dòng lịch thanh toán */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const b = await req.json().catch(() => ({})) as Record<string, string | number | undefined>
    if (!b.projectId || !b.supplier) return errorResponse('Cần dự án + NCC', 400)

    const created = await prisma.paymentSchedule.create({
      data: {
        projectId: String(b.projectId), purchaseOrderId: b.purchaseOrderId ? String(b.purchaseOrderId) : null,
        supplier: String(b.supplier), saleContract: b.saleContract ? String(b.saleContract) : null,
        value: Number(b.value) || 0, currency: b.currency ? String(b.currency) : 'VND',
        paymentMethod: b.paymentMethod ? String(b.paymentMethod) : null,
        signDate: d(b.signDate as string), lcDate: d(b.lcDate as string), etd: d(b.etd as string), eta: d(b.eta as string),
        documentDate: d(b.documentDate as string), lcDeadline: d(b.lcDeadline as string),
        paymentMonth: b.paymentMonth ? String(b.paymentMonth) : null, status: b.status ? String(b.status) : 'PLANNED',
        notes: b.notes ? String(b.notes) : null, createdBy: payload.userId,
      },
      select: { id: true },
    })
    return successResponse({ id: created.id }, 'Đã thêm dòng lịch thanh toán', 201)
  } catch (err) {
    console.error('POST payment-schedules error:', err)
    return errorResponse('Lỗi tạo lịch thanh toán', 500)
  }
}
