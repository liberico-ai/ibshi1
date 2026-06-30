import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'

const FREEZE_ROLES = ['R01', 'R03', 'R03a']

// GET /api/projects/[id]/baseline — get active baseline for project
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response

  const baseline = await prisma.projectBaseline.findFirst({
    where: { projectId: pResult.data.id, isActive: true },
    orderBy: { version: 'desc' },
  })

  return successResponse({ baseline })
}

// POST /api/projects/[id]/baseline — freeze current estimate as baseline
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, FREEZE_ROLES)) {
    return errorResponse('Chỉ KTKH hoặc BGĐ được đông cứng dự toán', 403)
  }

  const pResult = validateParams(await params, idParamSchema)
  if (!pResult.success) return pResult.response
  const { id: projectId } = pResult.data

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCode: true },
  })
  if (!project) return errorResponse('Dự án không tồn tại', 404)

  const body = await req.json().catch(() => ({})) as { label?: string; notes?: string }

  const lastBaseline = await prisma.projectBaseline.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  const nextVersion = (lastBaseline?.version ?? -1) + 1

  const budgets = await prisma.budget.findMany({
    where: { projectId },
    select: { category: true, planned: true, actual: true, committed: true, forecast: true },
  })

  const wfTasks = await prisma.workflowTask.findMany({
    where: { projectId },
    select: { id: true, stepCode: true, resultData: true },
  })

  const estimateData = wfTasks
    .filter(t => t.resultData && typeof t.resultData === 'object')
    .map(t => {
      const rd = t.resultData as Record<string, unknown>
      if (rd.estimate || rd.dt02Items || rd.dt03Items) {
        return { stepCode: t.stepCode, estimate: rd.estimate, dt02Items: rd.dt02Items, dt03Items: rd.dt03Items }
      }
      return null
    })
    .filter(Boolean)

  const snapshot: Record<string, unknown> = {
    frozenAt: new Date().toISOString(),
    projectCode: project.projectCode,
    budgets: budgets.map(b => ({
      category: b.category,
      planned: Number(b.planned),
      actual: Number(b.actual),
      committed: Number(b.committed),
      forecast: Number(b.forecast),
    })),
    estimates: estimateData,
  }

  if (nextVersion > 0) {
    await prisma.projectBaseline.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    })
  }

  const baseline = await prisma.projectBaseline.create({
    data: {
      projectId,
      version: nextVersion,
      label: body.label || `Rev.${nextVersion}`,
      frozenBy: user.userId,
      snapshot: snapshot as unknown as Record<string, never>,
      isActive: true,
      notes: body.notes || null,
    },
  })

  await logAudit(user.userId, 'CREATE', 'ProjectBaseline', baseline.id,
    { projectId, version: nextVersion, label: baseline.label }, getClientIP(req))

  return successResponse({
    baseline,
    message: `Đã đông cứng dự toán ${baseline.label} cho ${project.projectCode}`,
  })
}
