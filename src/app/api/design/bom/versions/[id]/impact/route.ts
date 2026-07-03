import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { computeImpact } from '@/lib/bom-diff-engine'

// GET /api/design/bom/versions/:id/impact — Impact analysis for this version
// ?baselineVersionId=<id> (optional): so tường minh với bản đó — cần khi version đã ACTIVE
// (mặc định computeImpact so với bản ACTIVE = chính nó → impact rỗng, bug #V2).
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

  const baselineVersionId = new URL(req.url).searchParams.get('baselineVersionId') || undefined
  if (baselineVersionId) {
    const baseline = await prisma.bomVersion.findUnique({
      where: { id: baselineVersionId },
      select: { id: true },
    })
    if (!baseline) return errorResponse('Không tìm thấy phiên bản baseline để so sánh', 404)
  }

  const impact = await computeImpact(id, baselineVersionId)

  return successResponse({ impact })
}
