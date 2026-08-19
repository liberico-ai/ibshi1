import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { groupCodeOf } from '@/lib/material-group'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']

/** GET — danh sách chọn NCC theo nhóm của BID. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const rows = await prisma.bidGroupSelection.findMany({
      where: { bidAnalysisId: id },
      select: { materialSubGroupCode: true, selectedVendorName: true, notes: true },
    })
    return successResponse({ selections: rows })
  } catch (err) {
    console.error('GET group-selection error:', err)
    return errorResponse('Lỗi tải chọn theo nhóm', 500)
  }
}

/** POST — chọn 1 NCC cho cả 1 nhóm vật tư. body: { groupCode, vendorName, notes? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền chọn NCC', 403)
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { groupCode?: string; vendorName?: string | null; notes?: string }
    const groupCode = String(body.groupCode || '').trim()
    if (!groupCode) return errorResponse('Thiếu mã nhóm vật tư', 400)
    const vendorName = body.vendorName ? String(body.vendorName).trim() : null

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        status: true, selectionMode: true,
        vendors: { select: { vendorName: true } },
        items: { select: { id: true, itemCode: true, grade: true } },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)
    if (bid.status === 'CONTRACTED') return errorResponse('BID đã ký hợp đồng', 409)
    if (bid.selectionMode !== 'PER_GROUP') return errorResponse('BID không ở chế độ chọn theo nhóm vật tư', 400)
    if (vendorName && !bid.vendors.some(v => v.vendorName === vendorName)) return errorResponse('NCC không thuộc BID này', 404)

    // Các dòng thuộc nhóm này (suy theo groupCodeOf).
    const itemIds = bid.items.filter(it => groupCodeOf(it) === groupCode).map(it => it.id)
    if (itemIds.length === 0) return errorResponse('Nhóm không có dòng nào', 404)

    await prisma.$transaction(async (tx) => {
      if (vendorName) {
        await tx.bidGroupSelection.upsert({
          where: { bidAnalysisId_materialSubGroupCode: { bidAnalysisId: id, materialSubGroupCode: groupCode } },
          create: { bidAnalysisId: id, materialSubGroupCode: groupCode, selectedVendorName: vendorName, selectedBy: payload.userId, notes: body.notes || null },
          update: { selectedVendorName: vendorName, selectedBy: payload.userId, selectedAt: new Date(), notes: body.notes || null },
        })
      } else {
        await tx.bidGroupSelection.deleteMany({ where: { bidAnalysisId: id, materialSubGroupCode: groupCode } })
      }
      // Đổ xuống cấp DÒNG (nguồn sự thật cho create-po).
      await tx.bidQuoteItem.updateMany({ where: { id: { in: itemIds } }, data: { selectedVendorName: vendorName, selectedAt: vendorName ? new Date() : null, selectedBy: vendorName ? payload.userId : null } })
      await tx.bidAnalysis.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'EVALUATING' } })
    })
    return successResponse({ groupCode, vendorName, applied: itemIds.length }, vendorName ? `Đã gán ${vendorName} cho nhóm (${itemIds.length} dòng)` : `Đã bỏ chọn NCC cho nhóm`)
  } catch (err) {
    console.error('POST group-selection error:', err)
    return errorResponse('Lỗi chọn NCC theo nhóm', 500)
  }
}
