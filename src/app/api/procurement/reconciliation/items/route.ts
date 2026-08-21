import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R03', 'R07', 'R07a', 'R08', 'R08a', 'R10']
const N = (v: unknown) => Number(v || 0)

/**
 * GET /api/procurement/reconciliation/items?projectId= — Đối soát MỨC DÒNG (mã VT).
 * So BID (dự toán duyệt, NCC được chọn) ↔ Mua thực tế (PO + HĐ đã ký) theo (dự án × NCC × mã VT).
 * Hóa đơn không có dòng chi tiết (chỉ tổng ở header) → không tham chiếu ở mức dòng; xem tab đối soát NCC.
 * Chỉ trả dòng CÓ cảnh báo. Resolution dùng chung bảng AlertResolution (canonicalKey = key dòng).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined

    const vendors = await prisma.vendor.findMany({ select: { id: true, name: true } })
    const vName = new Map(vendors.map(v => [v.id, v.name]))
    const vIdByName = new Map(vendors.map(v => [v.name.toLowerCase(), v.id]))
    const projs = await prisma.project.findMany({ where: projectId ? { id: projectId } : {}, select: { id: true, projectCode: true } })
    const pCode = new Map(projs.map(p => [p.id, p.projectCode]))

    type Cell = { projectId: string; vendorId: string; itemCode: string; itemName: string; uom: string; bidQty: number; bidValue: number; buyQty: number; buyValue: number }
    const map = new Map<string, Cell>()
    const norm = (c: string) => c.trim().toUpperCase()
    const ensure = (pid: string | null, vid: string | null | undefined, code: string, seed: { itemName?: string; uom?: string }) => {
      if (!pid || !vid || !code) return null
      const k = `${pid}|${vid}|${norm(code)}`
      if (!map.has(k)) map.set(k, { projectId: pid, vendorId: vid, itemCode: norm(code), itemName: seed.itemName || '', uom: seed.uom || '', bidQty: 0, bidValue: 0, buyQty: 0, buyValue: 0 })
      const c = map.get(k)!
      if (!c.itemName && seed.itemName) c.itemName = seed.itemName
      if (!c.uom && seed.uom) c.uom = seed.uom
      return c
    }

    // 1) BID: NCC được chọn theo mã VT.
    const bids = await prisma.bidAnalysis.findMany({
      where: { ...(projectId ? { projectId } : {}), status: { notIn: ['CANCELLED'] } },
      select: {
        projectId: true, vendors: { select: { id: true, vendorName: true } },
        items: { select: { itemCode: true, itemName: true, uom: true, qtyToBuy: true, selectedVendorName: true, offers: { select: { vendorId: true, unitPrice: true, totalPrice: true } } } },
      },
    })
    for (const b of bids) {
      if (!b.projectId) continue
      const vIdInBid = new Map(b.vendors.map(v => [v.vendorName.toLowerCase(), v.id]))
      for (const it of b.items) {
        if (!it.selectedVendorName || !it.itemCode) continue
        const erpVid = vIdByName.get(it.selectedVendorName.toLowerCase())
        const bidVid = vIdInBid.get(it.selectedVendorName.toLowerCase())
        const offer = bidVid ? it.offers.find(o => o.vendorId === bidVid) : undefined
        const qty = N(it.qtyToBuy)
        const value = N(offer?.totalPrice) > 0 ? N(offer?.totalPrice) : qty * N(offer?.unitPrice)
        const c = ensure(b.projectId, erpVid, it.itemCode, { itemName: it.itemName || '', uom: it.uom || '' })
        if (c) { c.bidQty += qty; c.bidValue += value }
      }
    }

    // 2) Mua — PO items.
    const poItems = await prisma.purchaseOrderItem.findMany({
      where: { itemCode: { not: null }, purchaseOrder: { status: { notIn: ['CANCELLED', 'REJECTED'] }, ...(projectId ? { projectId } : {}) } },
      select: { itemCode: true, description: true, unit: true, quantity: true, unitPrice: true, purchaseOrder: { select: { projectId: true, vendorId: true } } },
    })
    for (const it of poItems) {
      const c = ensure(it.purchaseOrder.projectId, it.purchaseOrder.vendorId, it.itemCode || '', { itemName: it.description || '', uom: it.unit || '' })
      if (c) { c.buyQty += N(it.quantity); c.buyValue += N(it.quantity) * N(it.unitPrice) }
    }

    // 3) Mua — HĐ đã ký (contract items).
    const ctItems = await prisma.purchaseContractItem.findMany({
      where: { itemCode: { not: null }, contract: { status: { notIn: ['CANCELLED'] }, ...(projectId ? { projectId } : {}) } },
      select: { itemCode: true, description: true, unit: true, contractQty: true, unitPriceNoVat: true, contract: { select: { projectId: true, vendorId: true } } },
    })
    for (const it of ctItems) {
      const c = ensure(it.contract.projectId, it.contract.vendorId, it.itemCode || '', { itemName: it.description || '', uom: it.unit || '' })
      if (c) { c.buyQty += N(it.contractQty); c.buyValue += N(it.contractQty) * N(it.unitPriceNoVat) }
    }

    const resolutions = await prisma.alertResolution.findMany({ select: { canonicalKey: true, resolvedBy: true, resolvedAt: true, note: true } })
    const resMap = new Map(resolutions.map(r => [r.canonicalKey, r]))

    const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.02
    const out = [...map.entries()].map(([key, c]) => {
      const flags: string[] = []
      let severity = 'LOW'
      const bidUnit = c.bidQty > 0 ? c.bidValue / c.bidQty : 0
      const buyUnit = c.buyQty > 0 ? c.buyValue / c.buyQty : 0
      if (c.bidQty > 0 && c.buyQty <= 0) { flags.push('BID_KHONG_MUA'); severity = 'MEDIUM' }
      if (c.buyQty > 0 && c.bidQty <= 0) { flags.push('MUA_NGOAI_BID'); severity = 'MEDIUM' }
      if (c.bidQty > 0 && c.buyQty > 0 && !near(c.bidQty, c.buyQty)) { flags.push('LECH_SL'); if (severity !== 'HIGH') severity = 'MEDIUM' }
      if (bidUnit > 0 && buyUnit > 0 && !near(bidUnit, buyUnit)) { flags.push('LECH_GIA'); severity = 'HIGH' }
      if (flags.length === 0) return null
      const res = resMap.get(key)
      return {
        key, projectCode: pCode.get(c.projectId) || '', vendorName: vName.get(c.vendorId) || '',
        itemCode: c.itemCode, itemName: c.itemName, uom: c.uom,
        bidQty: c.bidQty, bidValue: c.bidValue, bidUnit,
        buyQty: c.buyQty, buyValue: c.buyValue, buyUnit,
        deltaQty: c.buyQty - c.bidQty, deltaUnit: buyUnit - bidUnit,
        flags, severity, resolved: !!res, resolvedBy: res?.resolvedBy || null, resolvedAt: res?.resolvedAt || null, note: res?.note || null,
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.severity]! - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.severity]!))

    const kpi = { total: out.length, high: out.filter(x => x.severity === 'HIGH').length, medium: out.filter(x => x.severity === 'MEDIUM').length, resolved: out.filter(x => x.resolved).length }
    return successResponse({ rows: out, kpi, canResolve: requireRoles(user.roleCode, CAN) })
  } catch (err) {
    console.error('GET reconciliation/items error:', err)
    return errorResponse('Lỗi đối soát mức dòng', 500)
  }
}
