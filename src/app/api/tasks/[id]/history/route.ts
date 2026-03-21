import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/tasks/[id]/history — Task audit trail
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const { id } = await params

  const history = await prisma.auditLog.findMany({
    where: { entityId: id, entity: { in: ['TASK', 'TASK_COMMENT'] } },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ history })
}
