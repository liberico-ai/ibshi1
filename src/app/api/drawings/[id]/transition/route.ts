import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

const VALID_TRANSITIONS: Record<string, string[]> = {
  IFR: ['IFC'],         // Issue for Review → Issue for Construction
  IFC: ['AFC', 'IFR'],  // Issue for Construction → As-Built Final (or back to IFR)
  AFC: [],              // Final — no further transitions
}

// POST /api/drawings/[id]/transition — IFR→IFC→AFC status change
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()

    if (!['R01', 'R02', 'R04'].includes(user.roleCode)) {
      return errorResponse('Chỉ BGĐ (R01), PM (R02), hoặc Design (R04) mới được chuyển trạng thái bản vẽ', 403)
    }

    const pResult = validateParams(await params, idParamSchema)
    if (!pResult.success) return pResult.response
    const { id } = pResult.data
    const { nextStatus } = await req.json()

    if (!nextStatus) return errorResponse('Thiếu nextStatus')

    const drawing = await prisma.drawing.findUnique({ where: { id } })
    if (!drawing) return errorResponse('Không tìm thấy bản vẽ', 404)

    const allowed = VALID_TRANSITIONS[drawing.status] || []
    if (!allowed.includes(nextStatus)) {
      return errorResponse(`Không thể chuyển từ ${drawing.status} → ${nextStatus}. Chỉ cho phép: ${allowed.join(', ') || 'không có'}`)
    }

    const updated = await prisma.drawing.update({
      where: { id },
      data: { status: nextStatus },
    })

    await logAudit(user.userId, 'TRANSITION', 'Drawing', id,
      { from: drawing.status, to: nextStatus, drawingCode: drawing.drawingCode }, getClientIP(req))

    return successResponse({ drawing: updated }, `Đã chuyển ${drawing.drawingCode}: ${drawing.status} → ${nextStatus}`)
  } catch (err) {
    console.error('POST /api/drawings/[id]/transition error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
