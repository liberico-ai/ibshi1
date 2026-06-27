import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { diffBomVersions } from '@/lib/bom-diff-engine'

// GET /api/design/bom/versions/:id/diff — Diff this version vs the ACTIVE version
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params

  const version = await prisma.bomVersion.findUnique({
    where: { id },
    select: { id: true, bomId: true, status: true },
  })
  if (!version) return errorResponse('Không tìm thấy phiên bản BOM', 404)

  // Find the currently ACTIVE version of the same BOM
  const activeVersion = await prisma.bomVersion.findFirst({
    where: { bomId: version.bomId, status: 'ACTIVE' },
    select: { id: true },
  })

  // If no ACTIVE version exists, return empty diff
  if (!activeVersion) {
    return successResponse({
      diff: { oldVersionId: null, newVersionId: id, lines: [], summary: { added: 0, removed: 0, changed: 0 } },
    })
  }

  const diff = await diffBomVersions(activeVersion.id, id)

  return successResponse({ diff })
}
