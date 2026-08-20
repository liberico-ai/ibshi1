import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R08', 'R08a', 'R10']
// Ngày: nhận cả SERIAL Excel (số ~20000-90000), ISO, dd/mm/yyyy — tránh mất ngày khi client đọc không cellDates.
const d = (v: unknown): Date | null => {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const s = String(v ?? '').trim(); if (!s) return null
  if (/^\d{4,6}$/.test(s)) { const n = Number(s); if (n >= 20000 && n <= 90000) { const dt = new Date(Math.round((n - 25569) * 86400000)); return isNaN(dt.getTime()) ? null : dt } }
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) { let [, a, b, y] = m; if (y.length === 2) y = '20' + y; let day = a, mo = b; if (Number(b) > 12 && Number(a) <= 12) { day = b; mo = a }; const dt = new Date(`${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`); return isNaN(dt.getTime()) ? null : dt }
  const dt = new Date(s); return isNaN(dt.getTime()) ? null : dt
}
// Số: chịu "1,234.5" / "$1000" / "N/A" → 0.
const num = (v: unknown): number => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, ''); const n = Number(s); return Number.isFinite(n) ? n : 0 }
const FOOTER = /^(tổng|tong|sum|total|cộng|cong|đơn nhập khẩu|số tiền cần thanh toán)/i

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
      if (FOOTER.test(supplier)) return null // bỏ dòng "Tổng cộng"/footer
      return {
        projectId: b.projectId as string, supplier,
        saleContract: r.saleContract ? String(r.saleContract).trim() : null,
        value: num(r.value), currency: r.currency ? String(r.currency).trim() : 'VND',
        paymentMethod: r.paymentMethod ? String(r.paymentMethod).trim() : null,
        signDate: d(r.signDate), lcDate: d(r.lcDate), etd: d(r.etd), eta: d(r.eta),
        documentDate: d(r.documentDate), lcDeadline: d(r.lcDeadline),
        paymentMonth: r.paymentMonth ? String(r.paymentMonth).trim() : null,
        status: r.status ? String(r.status).trim() : 'PLANNED',
        notes: r.notes ? String(r.notes).trim() : null, createdBy: user.userId,
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)

    if (data.length === 0) return errorResponse(`Không dòng nào hợp lệ (${loi.length} lỗi thiếu NCC)`, 400)

    // Upsert theo (dự án + NCC + số HĐ) → re-import KHÔNG nhân đôi, cập nhật tại chỗ.
    let created = 0, updated = 0
    await prisma.$transaction(async (tx) => {
      for (const row of data) {
        const ex = await tx.paymentSchedule.findFirst({ where: { projectId: row.projectId, supplier: row.supplier, saleContract: row.saleContract }, select: { id: true } })
        if (ex) { const { createdBy, ...upd } = row; void createdBy; await tx.paymentSchedule.update({ where: { id: ex.id }, data: upd }); updated++ }
        else { await tx.paymentSchedule.create({ data: row }); created++ }
      }
    })
    return successResponse({ soDongNhan: rows.length, soDongNhap: data.length, created, updated, soDongBoQua: loi.length, loi }, `Đã nhập ${data.length} dòng lịch thanh toán (${created} mới, ${updated} cập nhật)${loi.length ? `, bỏ ${loi.length} thiếu NCC` : ''}`)
  } catch (err) {
    console.error('POST payment-schedules/import error:', err)
    return errorResponse('Lỗi nhập lịch thanh toán', 500)
  }
}
