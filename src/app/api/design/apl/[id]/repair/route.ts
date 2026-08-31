import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { describeDbError } from '@/lib/db-missing-table'
import { can } from '@/lib/permissions/can'
import { repairAplImport } from '@/lib/apl-backfill'

export const dynamic = 'force-dynamic'

// POST /api/design/apl/[id]/repair
// Bổ sung item / block_no / rollup cho bản APL nhập TRƯỚC khi có phần gộp khối.
// Không phải nhập lại file — mọi thứ suy ra được từ chính các dòng đã lưu.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!(await can(user, 'form.APL'))) return errorResponse('Bạn không có quyền sửa dữ liệu APL', 403)
    const { id } = await params

    const imp = await prisma.aplImport.findUnique({ where: { id }, select: { id: true, fileName: true } })
    if (!imp) return errorResponse('Không tìm thấy bản APL này', 404)

    const r = await repairAplImport(id)
    await logAudit(user.userId, 'REPAIR_APL', 'AplImport', id, { fileName: imp.fileName, ...r }, getClientIP(req))

    return successResponse(
      { ...r },
      `Đã sửa ${r.lines.toLocaleString('en-US')} dòng: điền ITEM cho ${r.itemsFilled.toLocaleString('en-US')} dòng, gộp lại ${r.heads.toLocaleString('en-US')} lệnh`,
    )
  } catch (err) {
    console.error('POST /api/design/apl/[id]/repair error:', err)
    return errorResponse(describeDbError(err, 'Lỗi khi sửa dữ liệu APL'), 500)
  }
}
