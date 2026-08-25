import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { projShort, yymmOf, deriveMatGroup, generateNextBidCode, suggestSubject, parseBidCode } from '@/lib/bidcode'
import { groupCodeOf, groupLabelOf } from '@/lib/material-group'

export const dynamic = 'force-dynamic'
const CAN_CREATE = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * POST /api/procurement/bid-analyses/from-pr-bulk-by-group
 * body: { projectId, prItemIds?: string[], urgent?, notes? }
 * [PORT Thương Mại] createBidFromPRBulkByGroup: gom PR item theo NHÓM vật tư → mỗi nhóm tạo 1 BID.
 * prItemIds bỏ trống → lấy TẤT CẢ PR item chưa vào BID của dự án. Tạo tuần tự để bidCode không đụng seq.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN_CREATE.includes(payload.roleCode)) return errorResponse('Bạn không có quyền tạo báo giá (RFQ)', 403)

    const body = await req.json().catch(() => ({})) as { projectId?: string; prItemIds?: string[]; urgent?: boolean; notes?: string }
    const { projectId, prItemIds, urgent = false, notes } = body
    if (!projectId) return errorResponse('Cần projectId', 400)

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, projectCode: true } })
    if (!project) return errorResponse('Dự án không tồn tại', 404)

    // Nối các BID ↔ task P3.5 để truy vết (ưu tiên task đang mở).
    const p35 = await prisma.task.findFirst({
      where: { projectId, taskType: 'P3.5' },
      orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { id: true },
    })

    // PR item của đúng dự án + chưa vào BID nào (lọc thêm theo prItemIds nếu có).
    const items = await prisma.purchaseRequestItem.findMany({
      where: {
        ...(Array.isArray(prItemIds) && prItemIds.length ? { id: { in: prItemIds } } : {}),
        bidQuoteItems: { none: {} },
        purchaseRequest: { projectId },
      },
      select: {
        id: true, prId: true, itemCode: true, description: true, profile: true, grade: true, unit: true,
        quantity: true, toBuyQty: true, materialGroupCode: true,
        material: { select: { materialCode: true, name: true, unit: true, unitPrice: true } },
      },
    })
    if (items.length === 0) return errorResponse('Không có PR item hợp lệ (có thể đã đưa vào BID khác)', 400)

    // QT19 bước 3: chỉ tách RFQ từ PR đã DUYỆT.
    const prIds2 = [...new Set(items.map(i => i.prId))]
    const parentPrs = await prisma.purchaseRequest.findMany({ where: { id: { in: prIds2 } }, select: { prCode: true, status: true } })
    const notApproved = parentPrs.filter(p => p.status !== 'APPROVED')
    if (notApproved.length) return errorResponse(`PR chưa được duyệt — duyệt trước khi tách RFQ: ${notApproved.map(p => `${p.prCode} (${p.status})`).join(', ')}`, 409)

    // Gom theo nhóm vật tư (groupCodeOf — khớp chế độ PER_GROUP).
    const groups = new Map<string, typeof items>()
    for (const it of items) {
      const g = groupCodeOf({ itemCode: it.itemCode, grade: it.grade })
      if (!groups.has(g)) groups.set(g, [])
      groups.get(g)!.push(it)
    }

    const proj = projShort(project.projectCode)
    const yymm = yymmOf()
    const created: Array<{ bidId: string; bidCode: string; groupCode: string; groupLabel: string; lines: number }> = []

    // Tạo TUẦN TỰ: generateNextBidCode đọc seq lớn nhất trong DB → phải commit từng BID trước khi sang nhóm sau.
    for (const [groupCode, groupItems] of groups) {
      const mat = deriveMatGroup(groupItems)
      const gen = await generateNextBidCode(prisma, { projShort: proj, yymm, mat, urgent })
      const parsed = parseBidCode(gen.code)!
      const norm = groupItems.map(it => ({
        id: it.id,
        itemCode: it.itemCode || it.material?.materialCode || '',
        itemName: it.description || it.material?.name || '',
        profile: it.profile || '', grade: it.grade || '', uom: it.unit || it.material?.unit || '',
        reqQty: Number(it.quantity) || 0,
        toBuyQty: Number(it.toBuyQty) > 0 ? Number(it.toBuyQty) : Number(it.quantity) || 0,
        estimateUnitPrice: Number(it.material?.unitPrice) || 0,
      }))
      const subject = suggestSubject(norm.map(n => ({ itemName: n.itemName })), project.projectCode)
      const bid = await prisma.$transaction(async (tx) => {
        const newBid = await tx.bidAnalysis.create({
          data: {
            projectId: project.id, bidCode: gen.code, sourceTaskId: p35?.id || null,
            bidCodeProj: parsed.proj, bidCodeYymm: parsed.yymm, bidCodeMat: parsed.matGroup,
            bidCodeSeq: parsed.seq, bidCodeVariant: parsed.variant, bidCodeUrgent: parsed.urgent,
            subject, bidDate: new Date(), status: 'OPEN', selectionMode: 'PER_GROUP',
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
        await tx.purchaseRequestItem.updateMany({ where: { id: { in: norm.map(n => n.id) } }, data: { statusFlag: 'Đang chào giá' } })
        return newBid
      })
      created.push({ bidId: bid.id, bidCode: bid.bidCode, groupCode, groupLabel: groupLabelOf(groupCode), lines: norm.length })
    }

    await logAudit(payload.userId, 'CREATE_BID_BULK_BY_GROUP', 'Project', projectId, { bids: created.map(c => c.bidCode), groups: created.length, totalLines: items.length }, getClientIP(req))
    return successResponse({ bids: created }, `Đã tạo ${created.length} RFQ theo ${created.length} nhóm vật tư (${items.length} dòng)`, 201)
  } catch (err) {
    console.error('POST from-pr-bulk-by-group error:', err)
    return errorResponse('Lỗi tạo RFQ hàng loạt', 500)
  }
}
