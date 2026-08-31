import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { describeDbError } from '@/lib/db-missing-table'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { can } from '@/lib/permissions/can'

export const dynamic = 'force-dynamic'

// GET /api/design/apl/[id] — thông tin lần nhập + mô hình cột (KHÔNG kèm dòng; dòng lấy ở /lines)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const { id } = await params

    const item = await prisma.aplImport.findUnique({ where: { id } })
    if (!item) return errorResponse('Không tìm thấy bản APL này', 404)
    return successResponse({ apl: item })
  } catch (err) {
    console.error('GET /api/design/apl/[id] error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi đọc APL'), 500)
  }
}

// DELETE /api/design/apl/[id] — xoá cả dòng (ON DELETE CASCADE)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(await can(user, 'form.APL'))) return errorResponse('Bạn không có quyền xoá APL', 403)
    const { id } = await params

    const item = await prisma.aplImport.findUnique({ where: { id }, select: { id: true, fileName: true, totalRows: true } })
    if (!item) return errorResponse('Không tìm thấy bản APL này', 404)

    await prisma.aplImport.delete({ where: { id } })
    await logAudit(user.userId, 'DELETE_APL', 'AplImport', id,
      { fileName: item.fileName, rows: item.totalRows }, getClientIP(req))

    return successResponse({}, `Đã xoá bản APL "${item.fileName}" (${item.totalRows.toLocaleString('en-US')} dòng)`)
  } catch (err) {
    console.error('DELETE /api/design/apl/[id] error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi đọc APL'), 500)
  }
}
