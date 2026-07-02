import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, unauthorizedResponse } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const projects = await prisma.project.findMany({
    where: { status: { not: 'CLOSED' } },
    select: { id: true, projectCode: true, projectName: true, status: true },
    orderBy: { projectCode: 'asc' },
  })

  return successResponse({ projects })
}
