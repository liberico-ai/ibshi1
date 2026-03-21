import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/warehouse/stats — Warehouse KPI dashboard
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    const [totalMaterials, materials, prPending, poActive, recentMovements] = await Promise.all([
      prisma.material.count(),
      prisma.material.findMany({
        select: { currentStock: true, minStock: true, unitPrice: true, category: true },
      }),
      prisma.purchaseRequest.count({ where: { status: 'SUBMITTED' } }),
      prisma.purchaseOrder.count({ where: { status: { in: ['SENT', 'CONFIRMED'] } } }),
      prisma.stockMovement.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          material: { select: { materialCode: true, name: true } },
        },
      }),
    ])

    const lowStockCount = materials.filter(m => Number(m.currentStock) <= Number(m.minStock)).length
    const totalValue = materials.reduce((sum, m) => sum + (m.unitPrice ? Number(m.unitPrice) * Number(m.currentStock) : 0), 0)
    const byCategory = materials.reduce((acc: Record<string, number>, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1
      return acc
    }, {})

    return successResponse({
      totalMaterials,
      lowStockCount,
      totalValue,
      prPending,
      poActive,
      byCategory,
      recentMovements: recentMovements.map(m => ({
        id: m.id,
        materialCode: m.material.materialCode,
        materialName: m.material.name,
        type: m.type,
        quantity: m.quantity,
        date: m.createdAt,
        reference: m.referenceNo,
      })),
    })
  } catch (err) {
    console.error('GET /api/warehouse/stats error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
