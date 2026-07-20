import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, forbiddenResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'

// DELETE /api/materials/aliases/[aliasId]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ aliasId: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!(await can(payload, 'action.material_code_admin'))) {
      return forbiddenResponse('Bạn không có quyền xoá mã bí danh')
    }

    const { aliasId } = await params
    if (!aliasId) return errorResponse('Thiếu aliasId', 400)

    const alias = await prisma.materialCodeAlias.findUnique({ where: { id: aliasId } })
    if (!alias) return errorResponse('Không tìm thấy mã bí danh', 404)

    await prisma.materialCodeAlias.delete({ where: { id: aliasId } })

    await logAudit(payload.userId, 'DELETE_ALIAS', 'Material', alias.materialId, { aliasCode: alias.aliasCode }, getClientIP(req))
    return successResponse({}, 'Đã xoá mã bí danh')
  } catch (err) {
    console.error('DELETE /api/materials/aliases/[aliasId] error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
