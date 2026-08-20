import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R08', 'R08a', 'R10']

// GET /api/purchase-contracts/[id]/items — dòng chi tiết HĐ + nghiệm thu QC.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params
    const items = await prisma.purchaseContractItem.findMany({
      where: { contractId: id }, orderBy: { createdAt: 'asc' },
      include: { inspections: { select: { inspectionType: true, reportNo: true, inspectionDate: true, acceptedQty: true, acceptedWeight: true, result: true } } },
    })
    return successResponse({
      items: items.map(it => ({
        id: it.id, itemCode: it.itemCode, description: it.description, unit: it.unit,
        actualProfile: it.actualProfile, actualGrade: it.actualGrade,
        contractQty: Number(it.contractQty), contractWeight: Number(it.contractWeight),
        unitPriceNoVat: Number(it.unitPriceNoVat), currency: it.currency,
        totalNoVat: Number(it.totalNoVat), totalWithVat: Number(it.totalWithVat),
        deliveredQty: Number(it.deliveredQty), deliveredWeight: Number(it.deliveredWeight),
        handoverDate: it.handoverDate, lineStatus: it.lineStatus,
        inspections: it.inspections.map(q => ({ type: q.inspectionType, reportNo: q.reportNo, date: q.inspectionDate, acceptedQty: Number(q.acceptedQty), acceptedWeight: Number(q.acceptedWeight), result: q.result })),
      })),
    })
  } catch (err) {
    console.error('GET contract items error:', err)
    return errorResponse('Lỗi tải dòng hợp đồng', 500)
  }
}

// POST /api/purchase-contracts/[id]/items — thêm 1 dòng HĐ. body: {itemCode, description, unit, actualProfile, actualGrade, contractQty, contractWeight, unitPriceNoVat, currency, vatRate}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền', 403)
    const { id } = await params
    const c = await prisma.purchaseContract.findUnique({ where: { id }, select: { id: true, currency: true } })
    if (!c) return errorResponse('Không tìm thấy HĐ', 404)
    const b = await req.json().catch(() => ({})) as Record<string, unknown>

    const qty = Number(b.contractQty) || 0
    const unitPrice = Number(b.unitPriceNoVat) || 0
    const vatRate = b.vatRate != null ? Number(b.vatRate) : 10
    const totalNoVat = qty * unitPrice
    const item = await prisma.purchaseContractItem.create({
      data: {
        contractId: id, prItemId: b.prItemId ? String(b.prItemId) : null, materialId: b.materialId ? String(b.materialId) : null,
        itemCode: b.itemCode ? String(b.itemCode) : null, description: b.description ? String(b.description) : null,
        unit: b.unit ? String(b.unit) : null, actualProfile: b.actualProfile ? String(b.actualProfile) : null, actualGrade: b.actualGrade ? String(b.actualGrade) : null,
        contractQty: qty, contractWeight: Number(b.contractWeight) || 0, unitPriceNoVat: unitPrice,
        currency: b.currency ? String(b.currency) : (c.currency || 'VND'), vatRate,
        totalNoVat, totalWithVat: totalNoVat * (1 + vatRate / 100),
      },
      select: { id: true },
    })
    return successResponse({ id: item.id }, 'Đã thêm dòng hợp đồng', 201)
  } catch (err) {
    console.error('POST contract item error:', err)
    return errorResponse('Lỗi thêm dòng hợp đồng', 500)
  }
}
