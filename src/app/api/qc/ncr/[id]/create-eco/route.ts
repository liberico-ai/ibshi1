import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { z } from 'zod'

const ncrToEcoSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  changeType: z.string().min(1).optional(),
  costBearer: z.enum(['INTERNAL', 'CUSTOMER', 'SUPPLIER', 'PRODUCTION_TEAM', 'SITE_TBD']).optional(),
  impactCost: z.number().optional(),
})

// POST /api/qc/ncr/[id]/create-eco — Create ECO from NCR
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, ['R01', 'R02', 'R04', 'R06', 'R09'])) {
    return errorResponse('Không có quyền tạo ECO từ NCR', 403)
  }

  const { id: ncrId } = await params

  const ncr = await prisma.nonConformanceReport.findUnique({
    where: { id: ncrId },
    select: { id: true, ncrCode: true, projectId: true, category: true, description: true, status: true },
  })
  if (!ncr) return errorResponse('NCR không tồn tại', 404)

  const existingEco = await prisma.engineeringChangeOrder.findFirst({
    where: { ncrId },
    select: { id: true, ecoCode: true },
  })
  if (existingEco) {
    return errorResponse(`NCR đã có ECO liên kết: ${existingEco.ecoCode}`, 409)
  }

  const result = await validateBody(req, ncrToEcoSchema)
  if (!result.success) return result.response
  const body = result.data

  const year = new Date().getFullYear().toString().slice(-2)
  const count = await prisma.engineeringChangeOrder.count()
  const ecoCode = `ECO-${year}-${String(count + 1).padStart(3, '0')}`

  const eco = await prisma.engineeringChangeOrder.create({
    data: {
      ecoCode,
      projectId: ncr.projectId,
      title: body.title || `NCR ${ncr.ncrCode} — ${ncr.category}`,
      description: body.description || `Tạo từ NCR ${ncr.ncrCode}: ${ncr.description}`,
      changeType: body.changeType || 'NCR_CORRECTIVE',
      source: 'PRODUCTION_NCR',
      costBearer: body.costBearer || 'PRODUCTION_TEAM',
      ncrId,
      impactCost: body.impactCost ?? null,
      requestedBy: user.userId,
    },
    include: {
      project: { select: { projectCode: true, projectName: true } },
    },
  })

  await logAudit(user.userId, 'CREATE', 'EngineeringChangeOrder', eco.id,
    { ncrId, ncrCode: ncr.ncrCode, source: 'PRODUCTION_NCR' }, getClientIP(req))

  return successResponse({
    eco,
    message: `Đã tạo ECO ${ecoCode} từ NCR ${ncr.ncrCode}`,
  })
}
