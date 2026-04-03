import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createNcrSchema } from '@/lib/schemas'

// GET /api/qc/ncr — List NCRs
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const severity = url.searchParams.get('severity') || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (severity) where.severity = severity

  const ncrs = await prisma.nonConformanceReport.findMany({
    where,
    include: {
      project: { select: { projectCode: true, projectName: true } },
      actions: { orderBy: { createdAt: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ ncrs })
}

// POST /api/qc/ncr — Create NCR
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R09', 'R09a', 'R06'])) {
    return errorResponse('Không có quyền tạo NCR', 403)
  }

  const result = await validateBody(req, createNcrSchema)
  if (!result.success) return result.response
  const { projectId, category, severity, description, rootCause } = result.data

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.nonConformanceReport.count()
  const ncrCode = `NCR-${year}-${String(count + 1).padStart(3, '0')}`

  const ncr = await prisma.nonConformanceReport.create({
    data: {
      ncrCode, projectId, category,
      severity: severity || 'MINOR',
      description, rootCause: rootCause || null,
      raisedBy: user.userId,
    },
  })

  return successResponse({ ncr, message: 'Đã tạo NCR' })
}
