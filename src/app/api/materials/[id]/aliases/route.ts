import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateBody, validateParams } from '@/lib/api-helpers'
import { addAliasSchema, idParamSchema } from '@/lib/schemas'
import { can } from '@/lib/permissions/can'

// POST /api/materials/[id]/aliases — attach an old/department code as alias
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(await can(payload, 'action.material_code_admin'))) {
      return forbiddenResponse('Bạn không có quyền thêm mã bí danh')
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data

    const result = await validateBody(req, addAliasSchema)
    if (!result.success) return result.response
    const { aliasCode, source, note } = result.data

    const material = await prisma.material.findUnique({ where: { id }, select: { id: true } })
    if (!material) return errorResponse('Không tìm thấy vật tư', 404)

    // alias must be globally unique, and must not collide with a canonical code
    const [aliasClash, codeClash] = await Promise.all([
      prisma.materialCodeAlias.findUnique({ where: { aliasCode }, select: { id: true, materialId: true } }),
      prisma.material.findUnique({ where: { materialCode: aliasCode }, select: { id: true } }),
    ])
    if (aliasClash) return errorResponse(`Mã "${aliasCode}" đã là bí danh của vật tư khác`, 409)
    if (codeClash) return errorResponse(`Mã "${aliasCode}" đang là mã chuẩn của một vật tư`, 409)

    const alias = await prisma.materialCodeAlias.create({
      data: { materialId: id, aliasCode, source, note, createdBy: payload.userId },
    })

    await logAudit(payload.userId, 'ADD_ALIAS', 'Material', id, { aliasCode, source }, getClientIP(req))
    return successResponse({ alias }, 'Đã thêm mã bí danh', 201)
  } catch (err) {
    console.error('POST /api/materials/[id]/aliases error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
