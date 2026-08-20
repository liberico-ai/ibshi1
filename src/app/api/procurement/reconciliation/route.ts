import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R02', 'R03', 'R07', 'R07a', 'R08', 'R08a', 'R10']
const N = (v: unknown) => Number(v || 0)

/**
 * GET /api/procurement/reconciliation?projectId= — Alert Center: đối soát 3 chiều
 * BID (dự toán duyệt) ↔ Mua (PO) ↔ Hóa đơn, theo (dự án × NCC). Chỉ trả dòng CÓ cảnh báo.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined

    // 1) Mua (PO) theo dự án × NCC
    const poGroups = await prisma.purchaseOrder.groupBy({
      by: ['projectId', 'vendorId'], _sum: { totalValue: true },
      where: { status: { notIn: ['CANCELLED', 'REJECTED'] }, ...(projectId ? { projectId } : {}) },
    })
    // 2) Hóa đơn theo dự án × NCC
    const invGroups = await prisma.invoice.groupBy({
      by: ['projectId', 'vendorId'], _sum: { totalAmount: true },
      where: { ...(projectId ? { projectId } : {}) },
    })
    // 3) BID (dự toán duyệt): tổng giá NCC được chọn theo (dự án × tên NCC)
    const bids = await prisma.bidAnalysis.findMany({
      where: projectId ? { projectId } : {},
      select: { projectId: true, vendors: { select: { id: true, vendorName: true } }, items: { select: { selectedVendorName: true, offers: { select: { vendorId: true, totalPrice: true } } } } },
    })
    const bidByProjVendorName = new Map<string, number>()
    for (const b of bids) {
      if (!b.projectId) continue
      const vId = new Map(b.vendors.map(v => [v.vendorName.toLowerCase(), v.id]))
      for (const it of b.items) {
        if (!it.selectedVendorName) continue
        const id = vId.get(it.selectedVendorName.toLowerCase())
        const offer = id ? it.offers.find(o => o.vendorId === id) : undefined
        const key = `${b.projectId}|${it.selectedVendorName.toLowerCase()}`
        bidByProjVendorName.set(key, (bidByProjVendorName.get(key) || 0) + N(offer?.totalPrice))
      }
    }

    // Danh mục tên/dự án
    const vendors = await prisma.vendor.findMany({ select: { id: true, name: true } })
    const vName = new Map(vendors.map(v => [v.id, v.name]))
    const vIdByName = new Map(vendors.map(v => [v.name.toLowerCase(), v.id]))
    const projs = await prisma.project.findMany({ where: projectId ? { id: projectId } : {}, select: { id: true, projectCode: true } })
    const pCode = new Map(projs.map(p => [p.id, p.projectCode]))

    // Gộp mọi key (projectId|vendorId)
    const rowsMap = new Map<string, { projectId: string; vendorId: string; bid: number; po: number; inv: number }>()
    const ensure = (pid: string | null, vid: string | null) => {
      if (!pid || !vid) return null
      const k = `${pid}|${vid}`
      if (!rowsMap.has(k)) rowsMap.set(k, { projectId: pid, vendorId: vid, bid: 0, po: 0, inv: 0 })
      return rowsMap.get(k)!
    }
    for (const g of poGroups) { const r = ensure(g.projectId, g.vendorId); if (r) r.po += N(g._sum.totalValue) }
    for (const g of invGroups) { const r = ensure(g.projectId, g.vendorId); if (r) r.inv += N(g._sum.totalAmount) }
    for (const [k, val] of bidByProjVendorName) { const [pid, vnl] = k.split('|'); const vid = vIdByName.get(vnl); const r = ensure(pid, vid || null); if (r) r.bid += val }

    // Cảnh báo + mức độ
    const resolutions = await prisma.alertResolution.findMany({ select: { canonicalKey: true, resolvedBy: true, resolvedAt: true, note: true } })
    const resMap = new Map(resolutions.map(r => [r.canonicalKey, r]))

    const out = [...rowsMap.entries()].map(([key, r]) => {
      const flags: string[] = []
      let severity = 'LOW'
      const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.02
      if (r.inv > 0 && r.po <= 0) { flags.push('HOA_DON_KHONG_PO'); severity = 'HIGH' }
      if (r.po > 0 && r.inv <= 0) { flags.push('CHUA_XUAT_HD'); if (severity !== 'HIGH') severity = 'MEDIUM' }
      if (r.po > 0 && r.inv > 0 && !near(r.po, r.inv)) { flags.push('LECH_MUA_HD'); if (severity !== 'HIGH') severity = 'MEDIUM' }
      if (r.bid > 0 && r.po <= 0) { flags.push('BID_KHONG_MUA'); }
      if (r.po > 0 && r.bid > 0 && !near(r.po, r.bid)) { flags.push('LECH_BID_MUA') }
      if (flags.length === 0) return null
      const res = resMap.get(key)
      return {
        key, projectCode: pCode.get(r.projectId) || '', vendorName: vName.get(r.vendorId) || '',
        bid: r.bid, po: r.po, inv: r.inv, deltaPoInv: r.po - r.inv, deltaBidPo: r.bid - r.po,
        flags, severity, resolved: !!res, resolvedBy: res?.resolvedBy || null, resolvedAt: res?.resolvedAt || null, note: res?.note || null,
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.severity]! - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.severity]!))

    const kpi = { total: out.length, high: out.filter(x => x.severity === 'HIGH').length, medium: out.filter(x => x.severity === 'MEDIUM').length, resolved: out.filter(x => x.resolved).length }
    return successResponse({ rows: out, kpi, canResolve: requireRoles(user.roleCode, CAN) })
  } catch (err) {
    console.error('GET reconciliation error:', err)
    return errorResponse('Lỗi đối soát', 500)
  }
}

// POST — đánh dấu đã xử lý. body: { key, note? }
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền', 403)
  const b = await req.json().catch(() => ({})) as { key?: string; note?: string }
  if (!b.key) return errorResponse('Thiếu key', 400)
  await prisma.alertResolution.upsert({
    where: { canonicalKey: b.key },
    create: { canonicalKey: b.key, resolvedBy: user.userId, note: b.note || null },
    update: { resolvedBy: user.userId, resolvedAt: new Date(), note: b.note || null },
  })
  return successResponse({ key: b.key }, 'Đã đánh dấu xử lý')
}

// DELETE ?key= — bỏ đánh dấu.
export async function DELETE(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền', 403)
  const key = new URL(req.url).searchParams.get('key') || ''
  if (!key) return errorResponse('Thiếu key', 400)
  await prisma.alertResolution.deleteMany({ where: { canonicalKey: key } })
  return successResponse({ key }, 'Đã bỏ đánh dấu')
}
