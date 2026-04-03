import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createItpSchema } from '@/lib/schemas'

// GET /api/qc/itp — List ITPs
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const projectId = url.searchParams.get('projectId') || undefined
  const status = url.searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (status) where.status = status

  const itps = await prisma.inspectionTestPlan.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      checkpoints: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = itps.map(itp => ({
    ...itp,
    totalCheckpoints: itp.checkpoints.length,
    passedCheckpoints: itp.checkpoints.filter(cp => cp.status === 'PASSED').length,
    failedCheckpoints: itp.checkpoints.filter(cp => cp.status === 'FAILED').length,
  }))

  return successResponse({ itps: result })
}

// POST /api/qc/itp — Create ITP
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a'])) {
    return errorResponse('Không có quyền tạo ITP', 403)
  }

  const result = await validateBody(req, createItpSchema)
  if (!result.success) return result.response
  const { projectId, name, checkpoints } = result.data

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.inspectionTestPlan.count()
  const itpCode = `ITP-${year}-${String(count + 1).padStart(3, '0')}`

  const itp = await prisma.inspectionTestPlan.create({
    data: {
      itpCode, projectId, name,
      checkpoints: checkpoints && checkpoints.length > 0 ? {
        create: checkpoints.map((cp, i) => ({
          checkpointNo: cp.checkpointNo ?? i + 1,
          activity: cp.activity,
          description: cp.description,
          standard: cp.standard || null,
          acceptCriteria: cp.acceptCriteria || null,
          inspectionType: cp.inspectionType || 'MONITOR',
          sortOrder: i + 1,
        })),
      } : undefined,
    },
    include: { checkpoints: true },
  })

  return successResponse({ itp, message: 'Đã tạo ITP' })
}
