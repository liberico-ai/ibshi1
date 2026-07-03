import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { withCache } from '@/lib/cache'

const ALLOWED_ROLES = ['R01', 'R03', 'R03a', 'R05', 'R05a', 'R08', 'R08a']

// GET /api/warehouse/stats — Warehouse KPI dashboard
export async function GET(req: NextRequest) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ALLOWED_ROLES)) return errorResponse('Forbidden', 403)

    const data = await withCache('warehouse:stats', 60, async () => {
      const [totalMaterials, materials, prPending, poActive, recentMovements, stockValueAgg] = await Promise.all([
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
        // Tổng giá trị tồn chuẩn = tổng value của tồn theo kho (gồm cả SKU tồn = 0 nhưng còn giá trị)
        prisma.materialStock.aggregate({ _sum: { value: true } }),
      ])

      const lowStockCount = materials.filter(m => Number(m.minStock) >= 0 && Number(m.currentStock) <= Number(m.minStock)).length
      // Ưu tiên tổng từ MaterialStock (per-kho); nếu chưa có dữ liệu thì fallback unitPrice×currentStock
      const stockValue = Number(stockValueAgg._sum.value || 0)
      const fallbackValue = materials.reduce((sum, m) => sum + (m.unitPrice ? Number(m.unitPrice) * Number(m.currentStock) : 0), 0)
      const totalValue = stockValue > 0 ? stockValue : fallbackValue
      const byCategory = materials.reduce((acc: Record<string, number>, m) => {
        acc[m.category] = (acc[m.category] || 0) + 1
        return acc
      }, {})

      return {
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
      }
    })

    return successResponse(data)
  } catch (err) {
    console.error('GET /api/warehouse/stats error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
