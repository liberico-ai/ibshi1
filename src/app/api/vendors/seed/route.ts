import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const sani = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20)

// POST /api/vendors/seed — Tạo NCC master từ NCC đã dự thầu (BidQuoteVendor) chưa có trong danh mục.
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ['R01', 'R07', 'R10'])) return errorResponse('Không có quyền seed NCC', 403)

    // Tên NCC đã xuất hiện trong đấu thầu (distinct, có loại NK/nội địa)
    const bqv = await prisma.bidQuoteVendor.findMany({ select: { vendorName: true, vendorType: true }, distinct: ['vendorName'] })
    const existing = await prisma.vendor.findMany({ select: { name: true } })
    const have = new Set(existing.map(v => v.name.trim().toLowerCase()))

    let created = 0
    for (const v of bqv) {
      const name = (v.vendorName || '').trim()
      if (!name || have.has(name.toLowerCase())) continue
      have.add(name.toLowerCase())
      let code = `VND-${sani(name)}`
      if (await prisma.vendor.findUnique({ where: { vendorCode: code }, select: { id: true } })) code = `${code}-${created + 1}`
      await prisma.vendor.create({ data: { vendorCode: code, name, category: 'SUPPLIER', vendorType: v.vendorType || 'DOMESTIC', isActive: true } })
      created++
    }
    return successResponse({ created, scanned: bqv.length }, created ? `Đã tạo ${created} NCC từ lịch sử đấu thầu` : 'Không có NCC mới để tạo')
  } catch (err) {
    console.error('POST /api/vendors/seed error:', err)
    return errorResponse('Lỗi seed NCC', 500)
  }
}
