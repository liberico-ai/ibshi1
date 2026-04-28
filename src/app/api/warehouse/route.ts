'use server'

import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { RBAC } from '@/lib/rbac-rules'

// GET /api/warehouse — List materials with stock levels
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const search = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    const where: Record<string, unknown> = {}
    if (category) where.category = category
    if (search) {
      where.OR = [
        { materialCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [total, materials] = await Promise.all([
      prisma.material.count({ where }),
      prisma.material.findMany({
        where,
        include: {
          stockMovements: {
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { id: true, type: true, quantity: true, reason: true, createdAt: true },
          },
        },
        orderBy: { materialCode: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    const result = materials.map((m: Record<string, unknown> & { stockMovements: Array<Record<string, unknown>> }) => ({
      id: m.id,
      materialCode: m.materialCode,
      name: m.name,
      nameEn: m.nameEn || '',
      unit: m.unit,
      category: m.category,
      specification: m.specification || '',
      grade: m.grade || '',
      minStock: Number(m.minStock),
      currentStock: Number(m.currentStock),
      reservedStock: Number(m.reservedStock || 0),
      availableStock: Number(m.currentStock) - Number(m.reservedStock || 0),
      unitPrice: m.unitPrice ? Number(m.unitPrice) : null,
      currency: m.currency,
      lowStock: Number(m.minStock) >= 0 ? Number(m.currentStock) < Number(m.minStock) : false,
      recentMovements: m.stockMovements.map((sm: Record<string, unknown>) => ({
        ...sm,
        quantity: Number(sm.quantity),
      })),
    }))

    return successResponse({
      materials: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/warehouse error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/warehouse — Create new material
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!RBAC.STORE_ACTION.includes(payload.roleCode)) {
      return errorResponse('Bạn không có quyền thêm vật tư', 403)
    }

    const body = await req.json()
    const { materialCode, name, unit, category, minStock, unitPrice, currency } = body

    if (!materialCode || !name || !unit || !category) {
      return errorResponse('Thiếu thông tin bắt buộc: mã, tên, đơn vị, danh mục')
    }

    const existing = await prisma.material.findUnique({ where: { materialCode } })
    if (existing) return errorResponse(`Mã vật tư ${materialCode} đã tồn tại`)

    const material = await prisma.material.create({
      data: {
        materialCode,
        name,
        unit,
        category,
        minStock: minStock ? parseFloat(minStock) : 0,
        unitPrice: unitPrice ? parseFloat(unitPrice) : null,
        currency: currency || 'VND',
      },
    })

    return successResponse({ material }, 'Vật tư đã được tạo', 201)
  } catch (err) {
    console.error('POST /api/warehouse error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
