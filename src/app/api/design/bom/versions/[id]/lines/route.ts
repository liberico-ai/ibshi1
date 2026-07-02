import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { replaceBomVersionLinesSchema } from '@/lib/schemas'

// GET /api/design/bom/versions/:id/lines — Lines của 1 BomVersion (mọi role đăng nhập)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params

  const version = await prisma.bomVersion.findUnique({
    where: { id },
    include: {
      lines: {
        include: { material: { select: { materialCode: true, name: true, unit: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  if (!version) return errorResponse('Không tìm thấy phiên bản BOM', 404)

  return successResponse({ lines: version.lines })
}

// PUT /api/design/bom/versions/:id/lines — REPLACE toàn bộ lines (chỉ version DRAFT)
// Body: { lines: [{ materialId, pieceMark?, category?, quantity, unit?, profile?, grade?, remarks? }] }
// Lưu ý: BomItem.materialId NOT NULL trong DB → bắt buộc mỗi dòng phải có materialId.
// parentId không hỗ trợ (danh sách phẳng — đủ cho mức piece-mark).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R04', 'R04a', 'R02'])) {
    return errorResponse('Không có quyền sửa lines của phiên bản BOM', 403)
  }

  const { id } = await params

  const result = await validateBody(req, replaceBomVersionLinesSchema)
  if (!result.success) return result.response
  const { lines } = result.data

  const version = await prisma.bomVersion.findUnique({ where: { id } })
  if (!version) return errorResponse('Không tìm thấy phiên bản BOM', 404)
  if (version.status !== 'DRAFT') {
    return errorResponse('Chỉ sửa được lines của version DRAFT', 422)
  }

  // Validate materialId tồn tại (batch 1 query) + lấy unit mặc định từ Material
  const materialIds = [...new Set(lines.map((l) => l.materialId))]
  const materialUnit = new Map<string, string>()
  if (materialIds.length > 0) {
    const materials = await prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, unit: true },
    })
    for (const m of materials) materialUnit.set(m.id, m.unit)
    const missing = materialIds.filter((mid) => !materialUnit.has(mid))
    if (missing.length > 0) {
      return errorResponse(`Vật tư không tồn tại: ${missing.join(', ')}`, 404)
    }
  }

  // Replace toàn bộ lines trong 1 transaction: deleteMany theo bomVersionId rồi createMany
  const updatedLines = await prisma.$transaction(async (tx) => {
    await tx.bomItem.deleteMany({ where: { bomVersionId: id } })

    if (lines.length > 0) {
      await tx.bomItem.createMany({
        data: lines.map((line, i) => ({
          bomId: version.bomId,
          bomVersionId: id,
          materialId: line.materialId,
          parentId: null,
          category: line.category || 'MAIN',
          pieceMark: line.pieceMark || null,
          quantity: line.quantity,
          unit: line.unit || materialUnit.get(line.materialId) || '',
          profile: line.profile || null,
          grade: line.grade || null,
          remarks: line.remarks || null,
          sortOrder: i,
        })),
      })
    }

    return tx.bomItem.findMany({
      where: { bomVersionId: id },
      include: { material: { select: { materialCode: true, name: true, unit: true } } },
      orderBy: { sortOrder: 'asc' },
    })
  })

  return successResponse({
    lines: updatedLines,
    message: `Đã thay ${lines.length} dòng cho phiên bản BOM`,
  })
}
