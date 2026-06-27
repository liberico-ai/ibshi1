import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { computeImpact } from '@/lib/bom-diff-engine'

// GET /api/design/bom/versions/:id/impact — Impact analysis for this version
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params

  // Verify version exists
  const version = await prisma.bomVersion.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!version) return errorResponse('Không tìm thấy phiên bản BOM', 404)

  const impact = await computeImpact(id)

  return successResponse({ impact })
}
