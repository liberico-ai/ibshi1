import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { approveRevision } from '@/lib/revision-flow'

// GET /api/design/bom/versions/:id — Get a single BomVersion
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
      bom: { select: { id: true, bomCode: true, name: true, projectId: true } },
      sourceRevision: true,
      eco: true,
    },
  })

  if (!version) return errorResponse('Không tìm thấy phiên bản BOM', 404)

  return successResponse({ version })
}

// PUT /api/design/bom/versions/:id — Update a BomVersion
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R04', 'R02'])) {
    return errorResponse('Không có quyền cập nhật phiên bản BOM', 403)
  }

  const { id } = await params

  let body: { status?: string; reason?: string; approvedBy?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  const existing = await prisma.bomVersion.findUnique({ where: { id } })
  if (!existing) return errorResponse('Không tìm thấy phiên bản BOM', 404)

  const { status, reason, approvedBy } = body

  // If activating this version, delegate to approveRevision (revision-flow) —
  // single source of truth: guard DRAFT + ECO APPROVED, supersede, activate,
  // flag needsReQc cho piece-mark bị ảnh hưởng, tạo task RE_QC (R09) + cascade (non-blocking)
  if (status === 'ACTIVE') {
    try {
      await approveRevision(id, user.userId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi khi duyệt phiên bản BOM'
      if (message === 'BomVersion không tồn tại') return errorResponse(message, 404)
      if (message.includes('chỉ DRAFT mới duyệt được') || message.includes('cần APPROVED')) {
        return errorResponse(message, 422)
      }
      return errorResponse(message, 400)
    }

    // Tương thích body cũ: FE có thể gửi kèm reason khi kích hoạt
    if (reason !== undefined) {
      await prisma.bomVersion.update({ where: { id }, data: { reason } })
    }

    // Fetch lại kèm include như cũ để giữ shape response cho FE
    const updated = await prisma.bomVersion.findUnique({
      where: { id },
      include: {
        lines: {
          include: { material: { select: { materialCode: true, name: true, unit: true } } },
          orderBy: { sortOrder: 'asc' },
        },
        bom: { select: { id: true, bomCode: true, name: true, projectId: true } },
        sourceRevision: true,
        eco: true,
      },
    })

    return successResponse({ version: updated, message: 'Đã kích hoạt phiên bản BOM' })
  }

  // For other status changes (SUPERSEDED, DRAFT) or field updates
  const updateData: Record<string, unknown> = {}
  if (status !== undefined) updateData.status = status
  if (reason !== undefined) updateData.reason = reason
  if (approvedBy !== undefined) updateData.approvedBy = approvedBy

  const updated = await prisma.bomVersion.update({
    where: { id },
    data: updateData,
    include: {
      lines: {
        include: { material: { select: { materialCode: true, name: true, unit: true } } },
        orderBy: { sortOrder: 'asc' },
      },
      bom: { select: { id: true, bomCode: true, name: true, projectId: true } },
      sourceRevision: true,
      eco: true,
    },
  })

  return successResponse({ version: updated })
}
