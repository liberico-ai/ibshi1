import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:contracts')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const { id } = await params

  const project = await prisma.project.findFirst({
    where: { OR: [{ projectCode: id }, { id }] },
    select: {
      id: true,
      projectCode: true,
      projectName: true,
      contractValue: true,
      currency: true,
      startDate: true,
      status: true,
      milestones: {
        select: {
          id: true, name: true, billingPercent: true,
          plannedDate: true, actualDate: true, status: true, sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  if (!project) return errorResponse('Contract/project not found', 404, 'NOT_FOUND')

  // Check if this project is also linked via a submission externalRef
  const sub = await prisma.projectSubmission.findFirst({
    where: { projectId: project.id },
    select: { externalRef: true },
  })

  return successResponse({
    data: {
      projectId: project.id,
      projectCode: project.projectCode,
      projectName: project.projectName,
      externalRef: sub?.externalRef || null,
      contractValue: project.contractValue ? Number(project.contractValue) : null,
      currency: project.currency,
      signedAt: project.startDate,
      status: project.status,
      milestones: project.milestones.map(m => ({
        id: m.id,
        name: m.name,
        billingPercent: m.billingPercent ? Number(m.billingPercent) : 0,
        plannedDate: m.plannedDate,
        actualDate: m.actualDate,
        status: m.status,
      })),
    },
  })
}
