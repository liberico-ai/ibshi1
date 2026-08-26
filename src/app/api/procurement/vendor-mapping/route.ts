import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const CAN = ['R01', 'R07', 'R07a', 'R10']
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * GET /api/procurement/vendor-mapping — Ánh xạ nhà cung cấp (dọn dữ liệu, khớp Commerce).
 * Liệt kê tên NCC tự do trong báo giá (BidQuoteVendor.vendorId = null) + gợi ý ghép với Vendor master.
 * POST { vendorName, vendorId } — ghép tất cả BidQuoteVendor cùng tên vào 1 Vendor (vendorId='__new__' → tạo mới).
 */
export async function GET(req: NextRequest, ) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const unmapped = await prisma.bidQuoteVendor.groupBy({ by: ['vendorName'], where: { vendorId: null }, _count: true })
    const vendors = await prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, name: true, shortName: true } })
    const rows = unmapped.map(u => {
      const n = norm(u.vendorName)
      // Gợi ý ghép: tên chứa nhau, hoặc shortName trùng.
      const suggest = vendors.find(v => { const vn = norm(v.name); return vn === n || vn.includes(n) || n.includes(vn) || (v.shortName && norm(v.shortName) === n) })
      return { vendorName: u.vendorName, count: u._count, suggestId: suggest?.id || null, suggestName: suggest?.name || null }
    }).sort((a, b) => b.count - a.count)
    return successResponse({ unmapped: rows, vendors: vendors.map(v => ({ id: v.id, name: v.name })), totalUnmapped: rows.length })
  } catch (err) {
    console.error('GET vendor-mapping error:', err)
    return errorResponse('Lỗi tải ánh xạ NCC', 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, CAN)) return errorResponse('Không có quyền ánh xạ NCC', 403)
    const b = await req.json().catch(() => ({})) as { vendorName?: string; vendorId?: string }
    const vendorName = String(b.vendorName || '').trim()
    if (!vendorName) return errorResponse('Thiếu tên NCC', 400)

    let vendorId = b.vendorId
    if (vendorId === '__new__' || !vendorId) {
      const v = await prisma.vendor.create({ data: { vendorCode: `VND-MAP-${Date.now().toString().slice(-6)}`, name: vendorName, category: 'SUPPLIER', isActive: true } })
      vendorId = v.id
    } else {
      const exists = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } })
      if (!exists) return errorResponse('Vendor không tồn tại', 404)
    }
    const r = await prisma.bidQuoteVendor.updateMany({ where: { vendorName, vendorId: null }, data: { vendorId } })
    await logAudit(user.userId, 'VENDOR_MAP', 'Vendor', vendorId!, { vendorName, linked: r.count }, getClientIP(req))
    return successResponse({ vendorId, linked: r.count }, `Đã ghép "${vendorName}" (${r.count} bản ghi) vào NCC`)
  } catch (err) {
    console.error('POST vendor-mapping error:', err)
    return errorResponse('Lỗi ánh xạ NCC', 500)
  }
}
