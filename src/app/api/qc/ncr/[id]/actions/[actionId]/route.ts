import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { updateNcrActionSchema } from '@/lib/schemas'

// PUT /api/qc/ncr/[id]/actions/[actionId] — Complete/reopen action
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; actionId: string }> }
) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a', 'R06'])) {
    return errorResponse('Không có quyền cập nhật action', 403)
  }

  const { id: ncrId, actionId } = await params
  const result = await validateBody(req, updateNcrActionSchema)
  if (!result.success) return result.response
  const { status, evidence } = result.data

  const action = await prisma.ncrAction.findFirst({
    where: { id: actionId, ncrId },
  })
  if (!action) return errorResponse('Action không tồn tại', 404)

  const updated = await prisma.ncrAction.update({
    where: { id: actionId },
    data: {
      status,
      ...(status === 'COMPLETED' ? { completedAt: new Date() } : { completedAt: null }),
      ...(evidence !== undefined ? { evidence } : {}),
    },
  })

  // Auto-advance NCR status when all actions completed
  const allActions = await prisma.ncrAction.findMany({
    where: { ncrId },
    select: { status: true },
  })
  const allDone = allActions.every(a => a.status === 'COMPLETED')

  if (allDone && allActions.length > 0) {
    await prisma.nonConformanceReport.update({
      where: { id: ncrId },
      data: { status: 'ACTION_TAKEN' },
    })
  }

  return successResponse({ action: updated, allActionsCompleted: allDone })
}
