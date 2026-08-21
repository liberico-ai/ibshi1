import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { nextPoCode } from '@/lib/po-code'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R07', 'R07a', 'R10']

/**
 * POST /api/procurement/bid-analyses/[id]/create-po
 * [PORT Thương Mại] Tạo PO từ BID đã duyệt — bám createPoFromBid: gom dòng theo NCC đã chọn
 * (selectedVendorName) → mỗi NCC 1 PurchaseOrder (status PENDING → vào hàng chờ duyệt của ERP).
 * Duyệt PO ở trang Đơn đặt hàng → syncPOtoBudget cập nhật Budget.committed (mạch ERP có sẵn).
 * Idempotent theo (BID, NCC): PO đã tạo cho NCC nào thì bỏ qua NCC đó.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!CAN.includes(payload.roleCode)) return errorResponse('Không có quyền tạo PO', 403)
    const { id } = await params

    const bid = await prisma.bidAnalysis.findUnique({
      where: { id },
      select: {
        id: true, bidCode: true, projectId: true,
        vendors: { select: { id: true, vendorName: true, vendorId: true, currency: true } },
        items: {
          select: {
            id: true, itemCode: true, itemName: true, profile: true, grade: true, uom: true,
            qtyToBuy: true, selectedVendorName: true, purchaseRequestItemId: true,
            prItem: { select: { materialId: true } },
            offers: { select: { vendorId: true, unitPrice: true, totalPrice: true } },
          },
        },
      },
    })
    if (!bid) return errorResponse('Không tìm thấy BID', 404)

    // Bỏ dòng placeholder (ghi chú/người đề nghị/ký) — không tạo PO cho dòng không phải vật tư (khớp Commerce).
    const PLACEHOLDER = /^(ghi ch[úu]|ng[ưu][ờo]i [đd][ềe] ngh[ịi]|note|remarks|k[ýy] t[êe]n|signature)/i
    const selected = bid.items.filter(it => it.selectedVendorName && !PLACEHOLDER.test(String(it.itemName || '').trim()))
    if (selected.length === 0) return errorResponse('Chưa chọn NCC cho dòng nào — vào tab Duyệt chọn NCC trước', 400)

    const bqvByName = new Map(bid.vendors.map(v => [v.vendorName.toLowerCase(), v]))

    // Chốt chặn giá 0: dòng đã chọn NCC nhưng NCC đó KHÔNG có báo giá hợp lệ (đơn giá ≤ 0 VÀ thành tiền ≤ 0)
    // → chặn tạo PO giá 0 (lỗi thầm lặng). Cho phép nhập tay thành tiền (totalPrice > 0) đè đơn giá.
    const invalidLines: string[] = []
    for (const it of selected) {
      const bqv = bqvByName.get(it.selectedVendorName!.toLowerCase())
      const offer = bqv ? it.offers.find(o => o.vendorId === bqv.id) : undefined
      if (!offer || (!(Number(offer.unitPrice) > 0) && !(Number(offer.totalPrice) > 0))) {
        invalidLines.push(`${it.itemCode || it.itemName || it.id} (NCC: ${it.selectedVendorName})`)
      }
    }
    if (invalidLines.length) {
      const head = invalidLines.slice(0, 8).join('; ')
      const more = invalidLines.length > 8 ? ` …+${invalidLines.length - 8} dòng` : ''
      return errorResponse(`Không thể tạo PO — ${invalidLines.length} dòng đã chọn NCC nhưng chưa có báo giá (>0): ${head}${more}. Vui lòng nhập báo giá hoặc bỏ chọn NCC cho các dòng này.`, 400)
    }
    type G = { name: string; bqv: (typeof bid.vendors)[number]; items: Array<{ id: string; itemCode: string | null; itemName: string | null; profile: string | null; grade: string | null; uom: string | null; qtyToBuy: number; materialId: string | null; prItemId: string | null; unitPrice: number; linePrice: number }> }
    const groups = new Map<string, G>()
    for (const it of selected) {
      const bqv = bqvByName.get(it.selectedVendorName!.toLowerCase())
      if (!bqv) continue
      const offer = it.offers.find(o => o.vendorId === bqv.id)
      const qty = Number(it.qtyToBuy || 0)
      const unitPrice = Number(offer?.unitPrice || 0)
      // Thành tiền: ưu tiên totalPrice đã lưu (có thể nhập tay) → khớp số BGĐ duyệt; else qty×đơn giá
      const linePrice = Number(offer?.totalPrice || 0) > 0 ? Number(offer!.totalPrice) : qty * unitPrice
      const key = it.selectedVendorName!
      if (!groups.has(key)) groups.set(key, { name: key, bqv, items: [] })
      groups.get(key)!.items.push({
        id: it.id, itemCode: it.itemCode, itemName: it.itemName, profile: it.profile, grade: it.grade, uom: it.uom,
        qtyToBuy: qty, materialId: it.prItem?.materialId || null,
        prItemId: it.purchaseRequestItemId || null, unitPrice, linePrice,
      })
    }

    // PO đã tạo cho BID này (idempotent theo vendorId)
    const existingPos = await prisma.purchaseOrder.findMany({ where: { bidAnalysisId: id }, select: { poCode: true, vendorId: true, totalValue: true } })
    const existingByVendor = new Map(existingPos.map(p => [p.vendorId, p]))

    const created: Array<{ poCode: string; vendorName: string; totalValue: number; existing?: boolean }> = []
    let idx = 0
    for (const g of groups.values()) {
      idx++
      // resolve Vendor ERP: ưu tiên link sẵn; else tìm theo tên; else tạo mới
      let erpVendorId = g.bqv.vendorId
      if (!erpVendorId) {
        let v = await prisma.vendor.findFirst({ where: { name: g.name } })
        if (!v) v = await prisma.vendor.create({ data: { vendorCode: `VND-AUTO-${Date.now()}-${idx}`, name: g.name, category: 'SUPPLIER', isActive: true } })
        erpVendorId = v.id
      }
      if (existingByVendor.has(erpVendorId)) {
        const ex = existingByVendor.get(erpVendorId)!
        created.push({ poCode: ex.poCode, vendorName: g.name, totalValue: Number(ex.totalValue || 0), existing: true })
        continue
      }
      const totalValue = g.items.reduce((s, it) => s + it.linePrice, 0)
      const poCode = await nextPoCode()
      const po = await prisma.purchaseOrder.create({
        data: {
          poCode, vendorId: erpVendorId, projectId: bid.projectId, status: 'PENDING',
          currency: g.bqv.currency || 'VND', orderDate: new Date(), createdBy: payload.userId,
          bidAnalysisId: id, notes: `Từ BID ${bid.bidCode}`, totalValue: Math.round(totalValue),
          items: {
            create: g.items.map(it => ({
              materialId: it.materialId, itemCode: it.itemCode, description: it.itemName,
              profile: it.profile, grade: it.grade, unit: it.uom, quantity: it.qtyToBuy, unitPrice: it.unitPrice,
            })),
          },
        },
        select: { poCode: true },
      })
      created.push({ poCode: po.poCode, vendorName: g.name, totalValue: Math.round(totalValue) })
    }

    // PR item đã ký HĐ — CHỈ item thực sự vào PO (đã gom nhóm), bỏ item bị skip (NCC không khớp)
    const prIds = [...groups.values()].flatMap(g => g.items.map(it => it.prItemId)).filter((x): x is string => !!x)
    if (prIds.length) await prisma.purchaseRequestItem.updateMany({ where: { id: { in: prIds } }, data: { statusFlag: 'Đã ký HĐ' } })
    await prisma.bidAnalysis.update({ where: { id }, data: { status: 'CONTRACTED' } })

    const newCount = created.filter(c => !c.existing).length
    await logAudit(payload.userId, 'CREATE_PO_FROM_BID', 'BidAnalysis', id, { bidCode: bid.bidCode, pos: created.map(c => c.poCode), newCount }, getClientIP(req))
    return successResponse({ pos: created }, `Đã tạo ${newCount} PO (PENDING — chờ duyệt ở Đơn đặt hàng)`, 201)
  } catch (err) {
    console.error('POST create-po (from bid) error:', err)
    return errorResponse('Lỗi tạo PO', 500)
  }
}
