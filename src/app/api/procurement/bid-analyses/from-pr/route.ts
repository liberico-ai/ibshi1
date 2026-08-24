import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { projShort, yymmOf, deriveMatGroup, generateNextBidCode, suggestSubject, parseBidCode } from '@/lib/bidcode'

export const dynamic = 'force-dynamic'

// Thương mại (chủ mua) + PM/BGĐ/Admin được tạo RFQ
const CAN_CREATE = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * POST /api/procurement/bid-analyses/from-pr
 * body: { projectId, prItemIds: string[], subject?, urgent?, notes? }
 * [PORT Thương Mại] Tạo BID (RFQ) từ các PR item đã chọn — bám createBidFromPR của Commerce:
 * sinh bidCode + BidQuoteItem cho từng PR item + set PR item statusFlag "Đang chào giá".
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN_CREATE.includes(payload.roleCode)) {
      return errorResponse('Bạn không có quyền tạo báo giá (RFQ)', 403)
    }

    const body = await req.json().catch(() => ({})) as {
      projectId?: string; prItemIds?: string[]; subject?: string; urgent?: boolean; notes?: string
    }
    const { projectId, prItemIds, subject, urgent = false, notes } = body
    if (!projectId || !Array.isArray(prItemIds) || prItemIds.length === 0) {
      return errorResponse('Cần projectId + prItemIds[]', 400)
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId }, select: { id: true, projectCode: true },
    })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    // Nối BID ↔ task P3.5 (Thương mại tìm NCC) để truy vết. Ưu tiên task đang mở (chưa hoàn thành).
    const p35 = await prisma.task.findFirst({
      where: { projectId, taskType: 'P3.5' },
      orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { id: true },
    })

    // PR item — chỉ lấy item của đúng dự án + chưa vào BID nào
    const items = await prisma.purchaseRequestItem.findMany({
      where: {
        id: { in: prItemIds },
        bidQuoteItems: { none: {} },
        purchaseRequest: { projectId },
      },
      select: {
        id: true, itemCode: true, description: true, profile: true, grade: true, unit: true,
        quantity: true, toBuyQty: true, materialGroupCode: true,
        material: { select: { materialCode: true, name: true, unit: true, unitPrice: true } },
      },
    })
    if (items.length === 0) return errorResponse('Không có PR item hợp lệ (có thể đã đưa vào BID khác)', 400)

    // Sinh mã BID
    const proj = projShort(project.projectCode)
    const yymm = yymmOf()
    const mat = deriveMatGroup(items)
    const gen = await generateNextBidCode(prisma, { projShort: proj, yymm, mat, urgent })
    const parsed = parseBidCode(gen.code)!

    const norm = items.map(it => ({
      id: it.id,
      itemCode: it.itemCode || it.material?.materialCode || '',
      itemName: it.description || it.material?.name || '',
      profile: it.profile || '',
      grade: it.grade || '',
      uom: it.unit || it.material?.unit || '',
      reqQty: Number(it.quantity) || 0,
      // toBuyQty mặc định DB = 0 (không null) → 0 thì dùng quantity (PR cũ chưa auto-fill Module 2)
      toBuyQty: Number(it.toBuyQty) > 0 ? Number(it.toBuyQty) : Number(it.quantity) || 0,
      // Dự toán đơn giá = đơn giá danh mục vật tư (nguồn để Gate 2 so giá mua vượt dự toán >2%).
      estimateUnitPrice: Number(it.material?.unitPrice) || 0,
    }))
    const finalSubject = subject || suggestSubject(norm.map(n => ({ itemName: n.itemName })), project.projectCode)

    const bid = await prisma.$transaction(async (tx) => {
      const newBid = await tx.bidAnalysis.create({
        data: {
          projectId: project.id, bidCode: gen.code, sourceTaskId: p35?.id || null,
          bidCodeProj: parsed.proj, bidCodeYymm: parsed.yymm, bidCodeMat: parsed.matGroup,
          bidCodeSeq: parsed.seq, bidCodeVariant: parsed.variant, bidCodeUrgent: parsed.urgent,
          subject: finalSubject, bidDate: new Date(), status: 'OPEN',
          notes: notes || null, createdBy: payload.userId,
          items: {
            create: norm.map((n, i) => ({
              purchaseRequestItemId: n.id, itemOrder: i + 1,
              itemCode: n.itemCode, itemName: n.itemName, profile: n.profile, grade: n.grade, uom: n.uom,
              qtyPr: n.reqQty, qtyToBuy: n.toBuyQty, estimateUnitPrice: n.estimateUnitPrice,
            })),
          },
        },
        select: { id: true, bidCode: true },
      })
      // Chống double-RFQ: PR item chuyển "Đang chào giá"
      await tx.purchaseRequestItem.updateMany({
        where: { id: { in: norm.map(n => n.id) } },
        data: { statusFlag: 'Đang chào giá' },
      })
      return newBid
    })

    return successResponse({ bidId: bid.id, bidCode: bid.bidCode }, `Đã tạo RFQ ${bid.bidCode} với ${items.length} dòng`, 201)
  } catch (err) {
    console.error('POST /api/procurement/bid-analyses/from-pr error:', err)
    return errorResponse('Lỗi tạo RFQ', 500)
  }
}
