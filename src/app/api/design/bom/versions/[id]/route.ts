import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

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

  // If activating this version, supersede the current ACTIVE version
  if (status === 'ACTIVE') {
    const updated = await prisma.$transaction(async (tx) => {
      // Supersede any currently ACTIVE version for the same BOM
      await tx.bomVersion.updateMany({
        where: { bomId: existing.bomId, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED' },
      })

      // Activate this version
      return tx.bomVersion.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          reason: reason !== undefined ? reason : undefined,
          approvedBy: approvedBy || user.userId,
          approvedAt: new Date(),
        },
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
