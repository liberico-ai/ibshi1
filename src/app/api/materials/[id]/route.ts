import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { updateMaterialSchema, idParamSchema } from '@/lib/schemas'
import { can } from '@/lib/permissions/can'

// GET /api/materials/[id] — detail + aliases
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const material = await prisma.material.findUnique({
      where: { id },
      include: {
        aliases: { orderBy: { createdAt: 'asc' } },
        stocks: {
          orderBy: { quantity: 'desc' },
          include: { warehouse: { select: { code: true, name: true, projectCode: true, kind: true } } },
        },
      },
    })
    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    return successResponse({
      material: {
        ...material,
        currentStock: Number(material.currentStock),
        reservedStock: Number(material.reservedStock),
        minStock: Number(material.minStock),
        unitPrice: material.unitPrice == null ? null : Number(material.unitPrice),
        stocks: material.stocks.map((s) => ({
          warehouseCode: s.warehouse.code,
          warehouseName: s.warehouse.name,
          projectCode: s.warehouse.projectCode,
          kind: s.warehouse.kind,
          quantity: Number(s.quantity),
          value: Number(s.value),
        })),
      },
    })
  } catch (err) {
    console.error('GET /api/materials/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PATCH /api/materials/[id] — update / approve provisional code
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(await can(payload, 'action.material_code_admin'))) {
      return forbiddenResponse('Bạn không có quyền sửa mã vật tư')
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const result = await validateBody(req, updateMaterialSchema)
    if (!result.success) return result.response

    const existing = await prisma.material.findUnique({ where: { id } })
    if (!existing) return errorResponse('Không tìm thấy vật tư', 404)

    const material = await prisma.material.update({ where: { id }, data: result.data })

    await logAudit(payload.userId, 'UPDATE', 'Material', id, result.data as Record<string, unknown>, getClientIP(req))
    return successResponse({ material }, 'Đã cập nhật vật tư')
  } catch (err) {
    console.error('PATCH /api/materials/[id] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
