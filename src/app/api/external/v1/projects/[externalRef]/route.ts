import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ externalRef: string }> },
) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:projects')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const { externalRef } = await params

  const sub = await prisma.projectSubmission.findUnique({
    where: { externalRef },
  })
  if (!sub) return errorResponse('Submission not found', 404, 'NOT_FOUND')

  const data: Record<string, unknown> = {
    externalRef: sub.externalRef,
    submissionId: sub.id,
    status: sub.status,
    createdAt: sub.createdAt,
  }

  if (sub.status === 'APPROVED') {
    data.projectId = sub.projectId
    data.projectCode = sub.projectCode
  }
  if (sub.status === 'REJECTED') {
    data.reason = sub.reason
  }

  return successResponse({ data })
}
