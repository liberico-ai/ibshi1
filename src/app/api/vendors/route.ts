import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// GET /api/vendors — List vendors with stats
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const where: Record<string, unknown> = {}
    if (category) where.category = category

    const vendors = await prisma.vendor.findMany({
      where,
      include: {
        _count: { select: { purchaseOrders: true, invoices: true, subcontracts: true } },
      },
      orderBy: { vendorCode: 'asc' },
    })

    const stats = await prisma.vendor.groupBy({ by: ['category'], _count: true })

    return successResponse({
      vendors,
      total: vendors.length,
      stats: stats.reduce((acc, s) => ({ ...acc, [s.category]: s._count }), {} as Record<string, number>),
    })
  } catch (err) {
    console.error('GET /api/vendors error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/vendors — Create vendor
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ['R01', 'R02', 'R07'])) {
      return errorResponse('Không có quyền tạo NCC', 403)
    }

    const body = await req.json()
    const { vendorCode, name, category, country, contactName, email, phone, address, notes } = body

    if (!vendorCode || !name || !category) {
      return errorResponse('Thiếu thông tin bắt buộc (mã, tên, loại)')
    }

    const existing = await prisma.vendor.findUnique({ where: { vendorCode } })
    if (existing) return errorResponse(`Mã NCC ${vendorCode} đã tồn tại`)

    const vendor = await prisma.vendor.create({
      data: {
        vendorCode, name, category,
        country: country || 'VN',
        contactName: contactName || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        notes: notes || null,
      },
    })

    return successResponse({ vendor, message: 'Đã tạo NCC' }, undefined, 201)
  } catch (err) {
    console.error('POST /api/vendors error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
