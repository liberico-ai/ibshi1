import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateVendorSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

// GET /api/vendors/[id] — Hồ sơ NCC + lịch sử giao dịch (PO) + thống kê (số PO, tổng giá trị).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const vendor = await prisma.vendor.findUnique({
      where: { id },
      include: {
        purchaseOrders: {
          orderBy: { orderDate: 'desc' }, take: 50,
          select: { id: true, poCode: true, orderDate: true, status: true, totalValue: true, currency: true, project: { select: { projectCode: true, projectName: true } }, _count: { select: { items: true } } },
        },
        _count: { select: { purchaseOrders: true, invoices: true, subcontracts: true, purchaseContracts: true } },
      },
    })
    if (!vendor) return errorResponse('Nhà cung cấp không tồn tại', 404)

    const totalValue = vendor.purchaseOrders.reduce((s, p) => s + Number(p.totalValue || 0), 0)
    const { purchaseOrders, ...profile } = vendor
    return successResponse({
      vendor: profile,
      stats: { poCount: vendor._count.purchaseOrders, contractCount: vendor._count.purchaseContracts, invoiceCount: vendor._count.invoices, subcontractCount: vendor._count.subcontracts, totalValue },
      transactions: purchaseOrders.map(p => ({
        id: p.id, poCode: p.poCode, orderDate: p.orderDate, status: p.status, itemCount: p._count.items,
        totalValue: Number(p.totalValue || 0), currency: p.currency, projectCode: p.project?.projectCode || '', projectName: p.project?.projectName || '',
      })),
    })
  } catch (err) {
    console.error('GET /api/vendors/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/vendors/[id] — Sửa hồ sơ NCC (bổ sung MST/ngân hàng/loại NCC/contact… + blacklist).
// Cho phép user bổ sung dần các field mới (Module 1 PORT Thương Mại). Chỉ BGĐ/PM/Thương mại/Quản trị.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!requireRoles(payload.roleCode, ['R01', 'R02', 'R07', 'R07a', 'R10'])) {
      return errorResponse('Bạn không có quyền sửa nhà cung cấp', 403)
    }
    const { id } = await params
    const result = await validateBody(req, updateVendorSchema)
    if (!result.success) return result.response

    const existing = await prisma.vendor.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return errorResponse('Nhà cung cấp không tồn tại', 404)

    // Các field undefined (không gửi) sẽ được Prisma bỏ qua → cập nhật bộ phận, an toàn.
    const d = result.data
    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        name: d.name, category: d.category, country: d.country,
        contactName: d.contactName, email: d.email, phone: d.phone, address: d.address,
        rating: d.rating, isActive: d.isActive, notes: d.notes,
        shortName: d.shortName, taxCode: d.taxCode, city: d.city, website: d.website,
        contactTitle: d.contactTitle, contactPhone: d.contactPhone, contactEmail: d.contactEmail,
        vendorType: d.vendorType, bank: d.bank, accountNo: d.accountNo, blacklisted: d.blacklisted,
      },
    })
    return successResponse({ vendor }, 'Đã cập nhật nhà cung cấp')
  } catch (err) {
    console.error('PATCH /api/vendors/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
