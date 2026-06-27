'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { searchFilterSchema } from '@/lib/schemas'

const ALLOWED_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R05', 'R05a', 'R07', 'R07a']

// GET /api/purchase-orders — List POs
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!requireRoles(payload.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const qResult = validateQuery(req.url, searchFilterSchema)
    if (!qResult.success) return qResult.response
    const { page, status } = qResult.data
    const limit = 20

    const where: Record<string, unknown> = {}
    if (status) {
      // Support comma-separated statuses, e.g. ?status=PAID,PARTIAL_RECEIVED
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean)
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0]
    }
    // Optional ?projectId=... for project-scoped views (e.g. Mua hàng section in project detail)
    const projectId = new URL(req.url).searchParams.get('projectId')
    if (projectId) where.projectId = projectId

    const [total, pos] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: {
          vendor: { select: { vendorCode: true, name: true } },
          items: {
            include: { material: { select: { materialCode: true, name: true, unit: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return successResponse({
      purchaseOrders: pos.map((po: Record<string, unknown> & { items: Array<Record<string, unknown>> }) => ({
        ...po,
        totalValue: Number(po.totalValue || 0),
        itemCount: po.items.length,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/purchase-orders error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
