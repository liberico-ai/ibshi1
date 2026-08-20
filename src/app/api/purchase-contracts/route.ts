import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

export const dynamic = 'force-dynamic'
const N = (v: unknown) => Number(v ?? 0)

/**
 * GET /api/purchase-contracts?vendor=&type=&status=&projectCode=
 * [PORT Thương Mại — Module 4] Danh sách Hợp đồng TOÀN CỤC (mọi dự án) — bám listContracts của Commerce.
 * ibshi1 đã có tạo/sửa/link-PO theo từng dự án; đây là view tổng hợp để tra cứu + lọc.
 */
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const sp = req.nextUrl.searchParams
    const vendor = sp.get('vendor')?.trim()
    const type = sp.get('type')?.trim()
    const status = sp.get('status')?.trim()
    const projectCode = sp.get('projectCode')?.trim()

    const where: Record<string, unknown> = {}
    if (type) where.contractType = type
    if (status) where.status = status
    if (vendor) where.vendor = { name: { contains: vendor, mode: 'insensitive' } }
    if (projectCode) where.project = { projectCode: { contains: projectCode, mode: 'insensitive' } }

    const contracts = await prisma.purchaseContract.findMany({
      where,
      orderBy: [{ signedDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, contractCode: true, contractType: true, tradeType: true, title: true, value: true, currency: true,
        signedDate: true, effectiveDate: true, arrivedDate: true, status: true, createdAt: true,
        vendor: { select: { name: true } },
        project: { select: { projectCode: true, projectName: true } },
        orders: { select: { id: true, poCode: true, status: true, totalValue: true } },
        _count: { select: { items: true } },
      },
    })

    const data = contracts.map(c => ({
      id: c.id, contractCode: c.contractCode, contractType: c.contractType, tradeType: c.tradeType, title: c.title,
      value: N(c.value), currency: c.currency, signedDate: c.signedDate, effectiveDate: c.effectiveDate, arrivedDate: c.arrivedDate, status: c.status,
      vendorName: c.vendor?.name || '—', projectCode: c.project?.projectCode || null, projectName: c.project?.projectName || '',
      itemCount: c._count.items,
      poCount: c.orders.length, poTotal: c.orders.reduce((s, o) => s + N(o.totalValue), 0),
      orders: c.orders.map(o => ({ id: o.id, poCode: o.poCode, status: o.status, totalValue: N(o.totalValue) })),
    }))

    const cnt = (s: string) => data.filter(d => d.status === s).length
    const summary = { total: data.length, draft: cnt('DRAFT'), active: cnt('ACTIVE'), completed: cnt('COMPLETED'), cancelled: cnt('CANCELLED'), totalValue: data.reduce((s, d) => s + d.value, 0) }

    return successResponse({ summary, contracts: data, total: data.length })
  } catch (err) {
    console.error('GET purchase-contracts (list) error:', err)
    return errorResponse('Lỗi tải danh sách hợp đồng', 500)
  }
}
