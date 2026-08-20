import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R08', 'R08a', 'R10']

// POST /api/purchase-contracts/[id]/items/import — nhập nhiều dòng HĐ từ Excel. body: { rows[] }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const c = await prisma.purchaseContract.findUnique({ where: { id }, select: { id: true, currency: true } })
    if (!c) return errorResponse('Không tìm thấy HĐ', 404)

    const b = await req.json().catch(() => ({})) as { rows?: Array<Record<string, unknown>> }
    const rows = Array.isArray(b.rows) ? b.rows : []
    if (rows.length === 0) return errorResponse('File không có dòng nào', 400)

    const loi: Array<{ dong: number; ly_do: string }> = []
    const data = rows.map((r, i) => {
      const itemCode = String(r.itemCode || '').trim()
      const description = String(r.description || '').trim()
      if (!itemCode && !description) { loi.push({ dong: i + 2, ly_do: 'thiếu mã & mô tả' }); return null }
      const qty = Number(r.contractQty) || 0
      const unitPrice = Number(r.unitPriceNoVat) || 0
      const vatRate = r.vatRate != null && r.vatRate !== '' ? Number(r.vatRate) : 10
      const totalNoVat = qty * unitPrice
      return {
        contractId: id, itemCode: itemCode || null, description: description || null,
        unit: r.unit ? String(r.unit).trim() : null, actualProfile: r.actualProfile ? String(r.actualProfile).trim() : null,
        actualGrade: r.actualGrade ? String(r.actualGrade).trim() : null,
        contractQty: qty, contractWeight: Number(r.contractWeight) || 0, unitPriceNoVat: unitPrice,
        currency: r.currency ? String(r.currency).trim() : (c.currency || 'VND'), vatRate,
        totalNoVat, totalWithVat: totalNoVat * (1 + vatRate / 100),
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)

    if (data.length === 0) return errorResponse(`Không dòng nào hợp lệ (${loi.length} lỗi)`, 400)
    await prisma.purchaseContractItem.createMany({ data })
    return successResponse({ soDongNhan: rows.length, soDongNhap: data.length, soDongBoQua: loi.length, loi }, `Đã nhập ${data.length} dòng HĐ${loi.length ? `, bỏ qua ${loi.length}` : ''}`)
  } catch (err) {
    console.error('POST contract items import error:', err)
    return errorResponse('Lỗi nhập dòng hợp đồng', 500)
  }
}
