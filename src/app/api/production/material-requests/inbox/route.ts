import { isMissingTableError, MIGRATION_HINT } from '@/lib/db-missing-table'
import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { buildWoMaterialLines, MR_STATUS } from '@/lib/wo-materials'
import { getProjectIdsOfPm } from '@/lib/project-pm'

// Hộp phiếu đề nghị cấp vật tư — dùng cho trang "Duyệt cấp vật tư".
// Mỗi vai trò thấy phần của mình:
//   • PM (R02/R02a): phiếu PENDING_PM của dự án MÌNH phụ trách
//   • BGĐ (R01), Admin (R10): PENDING_BOD (và xem được tất cả khi ?all=1)
//   • Xưởng (R06*): phiếu do xưởng mình lập, mọi trạng thái — để theo dõi
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const url = new URL(req.url)
    const all = url.searchParams.get('all') === '1'
    const statusParam = url.searchParams.get('status') || undefined

    const where: Record<string, unknown> = {}
    if (statusParam) where.status = statusParam

    let myRole: 'PM' | 'BOD' | 'WORKSHOP' | 'VIEWER' = 'VIEWER'
    if (['R02', 'R02a'].includes(user.roleCode)) {
      myRole = 'PM'
      const myProjectIds = await getProjectIdsOfPm(user.userId)
      if (!all) {
        where.status = statusParam || MR_STATUS.PENDING_PM
        where.projectId = { in: myProjectIds }
      }
    } else if (['R01', 'R10'].includes(user.roleCode)) {
      myRole = 'BOD'
      if (!all) where.status = statusParam || MR_STATUS.PENDING_BOD
    } else if (['R06', 'R06a', 'R06b'].includes(user.roleCode)) {
      myRole = 'WORKSHOP'
      const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { departmentId: true } })
      where.departmentId = me?.departmentId ?? null
    }

    const orders = await prisma.materialRequestOrder.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        department: { select: { code: true, name: true } },
        items: {
          select: {
            id: true, quantity: true, unit: true, source: true,
            material: { select: { materialCode: true, name: true, currentStock: true } },
            workOrder: { select: { id: true, woCode: true, description: true, teamCode: true, pieceMark: true, status: true } },
          },
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    })

    const items = orders.map(o => {
      const woIds = [...new Set(o.items.map(i => i.workOrder.id))]
      return {
        id: o.id, code: o.code, status: o.status,
        project: o.project, department: o.department,
        submittedAt: o.submittedAt, pmApprovedAt: o.pmApprovedAt, bodApprovedAt: o.bodApprovedAt,
        rejectReason: o.rejectReason, rejectedAt: o.rejectedAt,
        workOrderCount: woIds.length,
        lineCount: o.items.length,
        workOrders: woIds.map(id => {
          const w = o.items.find(i => i.workOrder.id === id)!.workOrder
          return { ...w, lines: o.items.filter(i => i.workOrder.id === id).map(i => ({
            materialCode: i.material.materialCode, name: i.material.name,
            quantity: Number(i.quantity), unit: i.unit, source: i.source,
            currentStock: Number(i.material.currentStock),
          })) }
        }),
      }
    })

    return successResponse({ items, myRole })
  } catch (err) {
    console.error('GET /api/production/material-requests/inbox error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// Chi tiết một phiếu kèm số đã cấp của từng lệnh (dùng khi mở xem trước lúc duyệt).
export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { orderId } = await req.json().catch(() => ({}))
    if (!orderId) return errorResponse('Thiếu mã phiếu')

    const order = await prisma.materialRequestOrder.findUnique({
      where: { id: String(orderId) },
      include: { items: { select: { workOrderId: true } } },
    })
    if (!order) return errorResponse('Không tìm thấy phiếu', 404)

    const woIds = [...new Set(order.items.map(i => i.workOrderId))]
    const detail: Record<string, Awaited<ReturnType<typeof buildWoMaterialLines>>> = {}
    for (const id of woIds) detail[id] = await buildWoMaterialLines(id, { requestId: order.id })

    return successResponse({ order, detail })
  } catch (err) {
    console.error('POST /api/production/material-requests/inbox error:', err)
    if (isMissingTableError(err)) return errorResponse(MIGRATION_HINT, 503)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
