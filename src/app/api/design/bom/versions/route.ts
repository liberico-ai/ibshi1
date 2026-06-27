import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// GET /api/design/bom/versions?bomId=xxx — List versions for a BOM
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const bomId = url.searchParams.get('bomId')
  if (!bomId) return errorResponse('bomId is required', 400)

  const versions = await prisma.bomVersion.findMany({
    where: { bomId },
    include: {
      bom: { select: { id: true, bomCode: true, name: true, projectId: true } },
      sourceRevision: true,
      eco: true,
    },
    orderBy: { versionNo: 'desc' },
  })

  return successResponse({ versions })
}

// POST /api/design/bom/versions — Create a new BomVersion
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R04', 'R04a', 'R02'])) {
    return errorResponse('Không có quyền tạo phiên bản BOM', 403)
  }

  let body: { bomId?: string; reason?: string; sourceRevisionId?: string; ecoId?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Invalid JSON body', 400)
  }

  const { bomId, reason, sourceRevisionId, ecoId } = body
  if (!bomId) return errorResponse('bomId is required', 400)

  // Verify BOM exists
  const bom = await prisma.billOfMaterial.findUnique({ where: { id: bomId } })
  if (!bom) return errorResponse('BOM không tồn tại', 404)

  // Auto-compute versionNo = max existing + 1
  const maxVersion = await prisma.bomVersion.aggregate({
    where: { bomId },
    _max: { versionNo: true },
  })
  const versionNo = (maxVersion._max.versionNo ?? 0) + 1

  // Find the currently ACTIVE version to copy items from
  const activeVersion = await prisma.bomVersion.findFirst({
    where: { bomId, status: 'ACTIVE' },
    include: {
      lines: true,
    },
  })

  // Create new version + copy lines in a transaction
  const newVersion = await prisma.$transaction(async (tx) => {
    const version = await tx.bomVersion.create({
      data: {
        bomId,
        versionNo,
        status: 'DRAFT',
        reason: reason || null,
        sourceRevisionId: sourceRevisionId || null,
        ecoId: ecoId || null,
        createdBy: user.userId,
      },
    })

    // Copy all BomItems from the ACTIVE version (if any) into the new version as DRAFT
    if (activeVersion && activeVersion.lines.length > 0) {
      await tx.bomItem.createMany({
        data: activeVersion.lines.map((line) => ({
          bomId,
          bomVersionId: version.id,
          materialId: line.materialId,
          parentId: line.parentId,
          category: line.category,
          pieceMark: line.pieceMark,
          quantity: line.quantity,
          unit: line.unit,
          profile: line.profile,
          grade: line.grade,
          remarks: line.remarks,
          sortOrder: line.sortOrder,
        })),
      })
    }

    // Return with lines included
    return tx.bomVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: {
        lines: {
          include: { material: { select: { materialCode: true, name: true, unit: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })
  })

  return successResponse({ version: newVersion, message: 'Đã tạo phiên bản BOM' })
}
