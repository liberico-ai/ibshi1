import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { upsertManHoursSchema } from '@/lib/schemas'

const WRITE_ROLES = ['R01', 'R09', 'R09a']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const year = url.searchParams.get('year')
  const projectId = url.searchParams.get('projectId')

  const where: Record<string, unknown> = {}
  if (year) where.periodYear = parseInt(year, 10)
  if (projectId) where.projectId = projectId

  const records = await prisma.hseManHours.findMany({
    where,
    include: { project: { select: { projectCode: true, projectName: true } } },
    orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
  })

  return successResponse({ records })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, WRITE_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, upsertManHoursSchema)
  if (!result.success) return result.response
  const data = result.data

  const projectId = data.projectId ?? null
  const existing = await prisma.hseManHours.findFirst({
    where: { periodYear: data.periodYear, periodMonth: data.periodMonth, projectId },
  })

  const record = existing
    ? await prisma.hseManHours.update({
        where: { id: existing.id },
        data: { manHours: data.manHours, note: data.note ?? null },
        include: { project: { select: { projectCode: true, projectName: true } } },
      })
    : await prisma.hseManHours.create({
        data: {
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          projectId,
          manHours: data.manHours,
          note: data.note ?? null,
          createdBy: user.userId,
        },
        include: { project: { select: { projectCode: true, projectName: true } } },
      })

  return successResponse({ record })
}
