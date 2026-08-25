import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { CONTRACT_WRITE_ROLES } from '@/lib/purchase-contract-constants'

export const dynamic = 'force-dynamic'

/**
 * POST /api/procurement/bid-analyses/[id]/create-contracts
 * B6 — "Thành hợp đồng": từ BID đã tạo PO → mỗi PO sinh 1 PurchaseContract (DRAFT) + snapshot dòng + gắn PO.
 * Idempotent: PO đã có contractId → bỏ qua (trả HĐ hiện có). Mã HĐ = HD-<poCode> (PO code đã unique).
 * HĐ tạo ở DRAFT + paymentTermsStatus DRAFT → đi tiếp bước B7 (duyệt điều kiện thanh toán).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CONTRACT_WRITE_ROLES.has(payload.roleCode) && payload.roleCode !== 'R10') return errorResponse('Không có quyền tạo hợp đồng', 403)
    const { id } = await params

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        id: true, bidCode: true,
        purchaseOrders: {
          select: {
            id: true, poCode: true, projectId: true, vendorId: true, currency: true, totalValue: true, contractId: true,
            items: { select: { itemCode: true, description: true, profile: true, grade: true, unit: true, quantity: true, unitPrice: true, materialId: true } },
          },
        },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)
    if (bid.purchaseOrders.length === 0) return errorResponse('BID chưa có PO nào — tạo PO trước (bước P3.6)', 400)

    const created: Array<{ contractCode: string; poCode: string; existing?: boolean; itemCount: number }> = []
    for (const po of bid.purchaseOrders) {
      // Idempotent: PO đã gắn HĐ → trả HĐ hiện có.
      if (po.contractId) {
        const ex = await prisma.purchaseContract.findUnique({ where: { id: po.contractId }, select: { contractCode: true, _count: { select: { items: true } } } })
        created.push({ contractCode: ex?.contractCode || '(?)', poCode: po.poCode, existing: true, itemCount: ex?._count.items || 0 })
        continue
      }
      let contractCode = `HD-${po.poCode}`
      // Chống trùng mã (hiếm): thêm hậu tố.
      if (await prisma.purchaseContract.findUnique({ where: { contractCode }, select: { id: true } })) {
        contractCode = `${contractCode}-${Date.now().toString().slice(-4)}`
      }
      const totalValue = Number(po.totalValue || 0)
      const contract = await prisma.$transaction(async (tx) => {
        const c = await tx.purchaseContract.create({
          data: {
            contractCode, contractType: 'HDMB', tradeType: 'DOMESTIC',
            projectId: po.projectId, vendorId: po.vendorId,
            title: `Hợp đồng mua bán — từ ${po.poCode} (BID ${bid.bidCode})`,
            value: totalValue, currency: po.currency || 'VND', status: 'DRAFT',
            paymentTermsStatus: 'DRAFT', createdBy: payload.userId,
            items: {
              create: po.items.map(it => ({
                prItemId: null, itemCode: it.itemCode, description: it.description,
                unit: it.unit, actualProfile: it.profile, actualGrade: it.grade,
                contractQty: Number(it.quantity || 0), unitPriceNoVat: Number(it.unitPrice || 0),
                currency: po.currency || 'VND',
              })),
            },
          },
          select: { id: true, contractCode: true, _count: { select: { items: true } } },
        })
        // Gắn PO vào HĐ.
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { contractId: c.id } })
        return c
      })
      created.push({ contractCode: contract.contractCode, poCode: po.poCode, itemCount: contract._count.items })
    }

    const newCount = created.filter(c => !c.existing).length
    await logAudit(payload.userId, 'CREATE_CONTRACTS_FROM_BID', 'BidAnalysis', id, { bidCode: bid.bidCode, contracts: created.map(c => c.contractCode), newCount }, getClientIP(req))
    return successResponse({ contracts: created }, `Đã tạo ${newCount} hợp đồng (DRAFT — đi tiếp bước duyệt điều kiện thanh toán)`, 201)
  } catch (err) {
    console.error('POST create-contracts (from bid) error:', err)
    return errorResponse('Lỗi tạo hợp đồng từ BID', 500)
  }
}
