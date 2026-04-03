'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { validateQuery } from '@/lib/api-helpers'
import { searchFilterSchema } from '@/lib/schemas'

// GET /api/purchase-orders — List POs
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const qResult = validateQuery(req.url, searchFilterSchema)
    if (!qResult.success) return qResult.response
    const { page, status } = qResult.data
    const limit = 20

    const where: Record<string, unknown> = {}
    if (status) where.status = status

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
