import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createRevisionWithEco } from '@/lib/revision-flow'
import { z } from 'zod'

/**
 * POST /api/design/bom/:id/create-revision — Finding A: luồng CHUẨN tạo revision LUÔN kèm ECO.
 *
 * :id = bomId. Gọi createRevisionWithEco (revision-flow.ts) → tạo DrawingRevision + ECO + BomVersion
 * trong 1 transaction, BomVersion.ecoId luôn được gắn. Chặn tận gốc lỗi "revise quên ECO → mất cascade"
 * (khác nút "Tao Rev moi" cũ ở POST /api/design/bom/versions vốn cho ecoId = null).
 *
 * - RBAC: thiết kế (R04/R04a), PM (R02), BGĐ (R01) — cùng bộ với CAN_CREATE_ROLES trên UI.
 * - projectId lấy THẬT từ BOM (không nhận từ client) — ECO/cascade dùng đúng project.
 * - drawingId phải cùng project với BOM (chống gắn revision sang dự án khác).
 * - revCode phải duy nhất trên drawing (DrawingRevision @@unique([drawingId, revision])).
 *
 * Zod schema định nghĩa INLINE (không thêm vào design.schema.ts).
 */

const createRevisionSchema = z.object({
  drawingId: z.string().min(1, 'drawingId là bắt buộc'),
  revCode: z.string().min(1, 'Mã revision là bắt buộc'),
  description: z.string().min(1, 'Mô tả thay đổi là bắt buộc'),
  ecoTitle: z.string().min(1, 'Tiêu đề ECO là bắt buộc'),
  ecoDescription: z.string().min(1, 'Nội dung ECO là bắt buộc'),
  changeType: z.string().min(1, 'Loại thay đổi là bắt buộc'),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    if (!requireRoles(user.roleCode, ['R01', 'R04', 'R04a', 'R02'])) {
      return errorResponse('Không có quyền tạo revision BOM', 403)
    }

    const { id: bomId } = await params

    const result = await validateBody(req, createRevisionSchema)
    if (!result.success) return result.response
    const { drawingId, revCode, description, ecoTitle, ecoDescription, changeType } = result.data

    // BOM phải tồn tại — lấy projectId THẬT để dựng ECO + cascade đúng dự án
    const bom = await prisma.billOfMaterial.findUnique({
      where: { id: bomId },
      select: { id: true, projectId: true },
    })
    if (!bom) return errorResponse('BOM không tồn tại', 404)

    // Drawing phải tồn tại và cùng project với BOM (chống gắn revision sang dự án khác)
    const drawing = await prisma.drawing.findUnique({
      where: { id: drawingId },
      select: { id: true, projectId: true },
    })
    if (!drawing) return errorResponse('Bản vẽ không tồn tại', 404)
    if (drawing.projectId !== bom.projectId) {
      return errorResponse('Bản vẽ không thuộc cùng dự án với BOM', 422)
    }

    // revCode phải duy nhất trên drawing (@@unique([drawingId, revision]))
    const existingRev = await prisma.drawingRevision.findFirst({
      where: { drawingId, revision: revCode },
      select: { id: true },
    })
    if (existingRev) {
      return errorResponse(`Revision "${revCode}" đã tồn tại trên bản vẽ này`, 422)
    }

    // createRevisionWithEco tự lo transaction: DrawingRevision + ECO + BomVersion (gắn ecoId)
    const { drawingRevision, eco, bomVersion } = await createRevisionWithEco({
      drawingId,
      revCode,
      description,
      bomId,
      ecoTitle,
      ecoDescription,
      changeType,
      userId: user.userId,
      projectId: bom.projectId,
    })

    return successResponse(
      { drawingRevision, eco, bomVersion },
      `Đã tạo revision ${revCode} kèm ECO ${eco.ecoCode} (BomVersion v${bomVersion.versionNo})`,
      201,
    )
  } catch (err) {
    // LOW race: revCode/ecoCode trùng do TOCTOU (2 người tạo đồng thời, hoặc ecoCode count()+1 đụng) → Prisma P2002.
    // Trả 422 thân thiện (retryable) thay vì 500. Transaction đã rollback nên KHÔNG hỏng data.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse('Mã revision hoặc mã ECO vừa bị trùng (có thao tác đồng thời) — vui lòng thử lại.', 422)
    }
    console.error('POST /api/design/bom/[id]/create-revision error:', err)
    return errorResponse('Lỗi hệ thống khi tạo revision', 500)
  }
}
