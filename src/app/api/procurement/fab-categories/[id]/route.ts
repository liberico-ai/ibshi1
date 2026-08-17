import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit } from '@/lib/auth'
import { FAB_WRITE_ROLES, chuanHoaHangMuc } from '@/lib/fab-allocation'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/procurement/fab-categories/[id]  body: { code?, name?, sortOrder?, ghiChu? }
 * [PORT Thương Mại] Sửa 1 hạng mục (bám updateFabCategory). 409 nếu đổi sang mã đã tồn tại trong dự án.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!FAB_WRITE_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params

    const cu = await prisma.fabricationCategory.findUnique({ where: { id } })
    if (!cu) return errorResponse('Không tìm thấy hạng mục', 404)

    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const hm = chuanHoaHangMuc({ code: cu.code, name: cu.name, sortOrder: cu.sortOrder, ghiChu: cu.ghiChu, ...body }, (cu.sortOrder ?? 1) - 1)
    if (!hm.code) return errorResponse('Thiếu mã hạng mục', 400)
    if (!hm.name) return errorResponse('Thiếu tên hạng mục', 400)

    if (hm.code !== cu.code) {
      const trung = await prisma.fabricationCategory.findFirst({ where: { projectId: cu.projectId, code: hm.code, NOT: { id } }, select: { id: true } })
      if (trung) return errorResponse(`Mã "${hm.code}" đã có trong dự án này`, 409)
    }

    const moi = await prisma.fabricationCategory.update({ where: { id }, data: hm })
    await logAudit(payload.userId, 'UPDATE_FAB_CATEGORY', 'FabricationCategory', id, { code: hm.code })
    return successResponse({ category: moi }, 'Đã cập nhật hạng mục')
  } catch (err) {
    console.error('PATCH fab-category error:', err)
    return errorResponse('Lỗi sửa hạng mục', 500)
  }
}

/**
 * DELETE /api/procurement/fab-categories/[id]
 * [PORT Thương Mại] Xóa 1 hạng mục (bám deleteFabCategory). Từ chối 409 nếu đang có phân bổ.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    if (!FAB_WRITE_ROLES.includes(payload.roleCode)) return errorResponse('Không có quyền', 403)
    const { id } = await params

    const hm = await prisma.fabricationCategory.findUnique({ where: { id } })
    if (!hm) return errorResponse('Không tìm thấy hạng mục', 404)

    const soPhanBo = await prisma.purchaseRequestItemFabAllocation.count({ where: { fabricationCategoryId: id } })
    if (soPhanBo > 0) return errorResponse(`Hạng mục "${hm.code}" đang có ${soPhanBo} dòng phân bổ. Gỡ phân bổ trước rồi mới xóa được.`, 409)

    await prisma.fabricationCategory.delete({ where: { id } })
    await logAudit(payload.userId, 'DELETE_FAB_CATEGORY', 'FabricationCategory', id, { code: hm.code })
    return successResponse({ deleted: hm.code }, `Đã xóa hạng mục ${hm.code}`)
  } catch (err) {
    console.error('DELETE fab-category error:', err)
    return errorResponse('Lỗi xóa hạng mục', 500)
  }
}
