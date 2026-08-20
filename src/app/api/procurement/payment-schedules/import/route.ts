import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R08', 'R08a', 'R10']
const d = (v: unknown): Date | null => { const s = String(v || '').trim(); if (!s) return null; const dt = new Date(s); return isNaN(dt.getTime()) ? null : dt }

// POST /api/procurement/payment-schedules/import — body: { projectId, rows[] } — nhập nhiều dòng lịch thanh toán từ Excel.
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền', 403)

    const b = await req.json().catch(() => ({})) as { projectId?: string; rows?: Array<Record<string, unknown>> }
    if (!b.projectId) return errorResponse('Cần chọn dự án', 400)
    const rows = Array.isArray(b.rows) ? b.rows : []
    if (rows.length === 0) return errorResponse('File không có dòng nào', 400)

    const loi: Array<{ dong: number; ly_do: string }> = []
    const data = rows.map((r, i) => {
      const supplier = String(r.supplier || '').trim()
      if (!supplier) { loi.push({ dong: i + 2, ly_do: 'thiếu NCC' }); return null }
      return {
        projectId: b.projectId as string, supplier,
        saleContract: r.saleContract ? String(r.saleContract).trim() : null,
        value: Number(r.value) || 0, currency: r.currency ? String(r.currency).trim() : 'VND',
        paymentMethod: r.paymentMethod ? String(r.paymentMethod).trim() : null,
        signDate: d(r.signDate), lcDate: d(r.lcDate), etd: d(r.etd), eta: d(r.eta),
        documentDate: d(r.documentDate), lcDeadline: d(r.lcDeadline),
        paymentMonth: r.paymentMonth ? String(r.paymentMonth).trim() : null,
        status: r.status ? String(r.status).trim() : 'PLANNED',
        notes: r.notes ? String(r.notes).trim() : null, createdBy: user.userId,
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)

    if (data.length === 0) return errorResponse(`Không dòng nào hợp lệ (${loi.length} lỗi thiếu NCC)`, 400)
    await prisma.paymentSchedule.createMany({ data })
    return successResponse({ soDongNhan: rows.length, soDongNhap: data.length, soDongBoQua: loi.length, loi }, `Đã nhập ${data.length} dòng lịch thanh toán${loi.length ? `, bỏ qua ${loi.length}` : ''}`)
  } catch (err) {
    console.error('POST payment-schedules/import error:', err)
    return errorResponse('Lỗi nhập lịch thanh toán', 500)
  }
}
