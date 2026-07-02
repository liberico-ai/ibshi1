import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { withErrorHandler } from '@/lib/with-error-handler'

const ALLOWED_ROLES = ['R01', 'R02', 'R06']

// POST /api/production/work-orders/from-bom — Sinh WO từ BOM version đã duyệt (ACTIVE)
// Body: { projectId, bomVersionId? }
// Idempotent: mỗi piece-mark chỉ có 1 WO trong dự án — gọi lại không tạo trùng.
export const POST = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()
  if (!ALLOWED_ROLES.includes(payload.roleCode)) {
    return errorResponse('Không có quyền sinh lệnh sản xuất từ BOM', 403)
  }

  const body = await req.json()
  const { projectId, bomVersionId } = body as { projectId?: string; bomVersionId?: string }
  if (!projectId) return errorResponse('Thiếu projectId')

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true },
  })
  if (!project) return errorResponse('Không tìm thấy dự án', 404)

  // Lấy BOM version: chỉ định qua bomVersionId, hoặc version ACTIVE mới nhất của dự án
  let version: { id: string; lines: Array<{ pieceMark: string | null }> } | null = null
  if (bomVersionId) {
    const v = await prisma.bomVersion.findUnique({
      where: { id: bomVersionId },
      include: {
        bom: { select: { projectId: true } },
        lines: { select: { pieceMark: true } },
      },
    })
    if (!v) return errorResponse('Không tìm thấy BOM version', 404)
    if (v.bom.projectId !== projectId) return errorResponse('BOM version không thuộc dự án này')
    version = v
  } else {
    version = await prisma.bomVersion.findFirst({
      where: { status: 'ACTIVE', bom: { projectId } },
      orderBy: { approvedAt: 'desc' },
      include: { lines: { select: { pieceMark: true } } },
    })
    if (!version) return errorResponse('Dự án chưa có BOM version nào được duyệt (ACTIVE)', 404)
  }

  // Piece-mark duy nhất, bỏ rỗng
  const pieceMarks = Array.from(
    new Set(
      version.lines
        .map(l => (l.pieceMark || '').trim())
        .filter(pm => pm.length > 0)
    )
  )
  if (pieceMarks.length === 0) {
    return errorResponse('BOM version không có piece-mark nào để sinh WO')
  }

  // Idempotent: bỏ qua piece-mark đã có WO trong dự án
  const existing = await prisma.workOrder.findMany({
    where: { projectId, pieceMark: { in: pieceMarks } },
    select: { pieceMark: true },
  })
  const existingMarks = new Set(existing.map(w => w.pieceMark))
  const toCreate = pieceMarks.filter(pm => !existingMarks.has(pm))

  let created = 0
  if (toCreate.length > 0) {
    const result = await prisma.workOrder.createMany({
      data: toCreate.map(pm => ({
        woCode: `WO-${project.projectCode}-${pm}`,
        projectId,
        description: `Gia công piece-mark ${pm} (sinh từ BOM)`,
        teamCode: 'TBD',
        pieceMark: pm,
        bomVersionId: version!.id,
        createdBy: payload.userId,
      })),
      skipDuplicates: true,
    })
    created = result.count
  }

  return successResponse({
    created,
    skipped: pieceMarks.length - created,
    bomVersionId: version.id,
  }, `Đã tạo ${created} WO, bỏ qua ${pieceMarks.length - created} piece-mark đã có WO`)
})
