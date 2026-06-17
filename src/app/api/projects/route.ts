import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP, getUserProjectIds } from '@/lib/auth'
import { withCache, cacheInvalidate, CACHE_KEYS } from '@/lib/cache'
import { validateQuery, validateBody } from '@/lib/api-helpers'
import { projectListQuerySchema, createProjectSchema } from '@/lib/schemas'
import { withErrorHandler } from '@/lib/with-error-handler'

// GET /api/projects — List all projects
export const GET = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  const qResult = validateQuery(req.url, projectListQuerySchema)
  if (!qResult.success) return qResult.response
  const { page, limit, search, status } = qResult.data

  const cacheKey = `projects:list:${payload.userId}:${status || ''}:${search}:${page}:${limit}`
  const data = await withCache(cacheKey, 60, async () => {
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (search) {
      where.OR = [
        { projectCode: { contains: search, mode: 'insensitive' } },
        { projectName: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
      ]
    }

    // RLS: non-R01 users see only their projects (PM + assigned tasks)
    if (payload.roleCode !== 'R01') {
      const projectIds = await getUserProjectIds(payload)
      if (projectIds !== null && projectIds.length > 0) {
        where.id = { in: projectIds }
      } else if (projectIds !== null) {
        where.pmUserId = payload.userId // fallback
      }
    }

    const [total, projects] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        include: {
          tasks: { select: { stepCode: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    const result = projects.map((p) => {
      const totalTasks = p.tasks.length
      const completed = p.tasks.filter((t) => t.status === 'DONE').length
      return {
        id: p.id,
        projectCode: p.projectCode,
        projectName: p.projectName,
        clientName: p.clientName,
        productType: p.productType,
        status: p.status,
        contractValue: p.contractValue?.toString(),
        currency: p.currency,
        startDate: p.startDate,
        endDate: p.endDate,
        progress: totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0,
        totalTasks,
        completedTasks: completed,
      }
    })

    return {
      projects: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  })

  return successResponse(data)
})

// POST /api/projects — Create new project
export const POST = withErrorHandler(async (req: NextRequest) => {
  const payload = await authenticateRequest(req)
  if (!payload) return unauthorizedResponse()

  if (!['R01', 'R02', 'R02a'].includes(payload.roleCode)) {
    return errorResponse('Bạn không có quyền tạo dự án', 403)
  }

  const result = await validateBody(req, createProjectSchema)
  if (!result.success) return result.response
  const { projectCode, projectName, clientName, productType, projectType,
          contractValue, currency, startDate, endDate, description,
          draftId } = result.data

  const existing = await prisma.project.findUnique({ where: { projectCode } })
  if (existing) return errorResponse(`Mã dự án ${projectCode} đã tồn tại`)

  const project = await prisma.project.create({
    data: {
      projectCode,
      projectName,
      clientName,
      productType,
      projectType,
      contractValue: contractValue ? parseFloat(String(contractValue)) : null,
      currency: currency || 'VND',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      pmUserId: payload.userId,
      description,
    },
  })

  // ── Link draft files to the real project ──
  // MultiFileUpload uploaded files with entityType="ProjectDraft" and entityId="${draftId}_xxx"
  // Now re-link them to entityType="Project" and entityId="${projectId}_xxx"
  let linkedCount = 0
  if (draftId) {
    try {
      const draftFiles = await prisma.fileAttachment.findMany({
        where: { entityType: 'ProjectDraft', entityId: { startsWith: draftId } },
      })
      for (const file of draftFiles) {
        const suffix = file.entityId.slice(draftId.length) // e.g. "_rfq"
        await prisma.fileAttachment.update({
          where: { id: file.id },
          data: { entityType: 'Project', entityId: `${project.id}${suffix}` },
        })
        linkedCount++
      }
    } catch (linkErr) {
      console.warn('POST /api/projects: draft file linking failed:', linkErr)
    }
  }

  // [Thuần ad-hoc] KHÔNG auto-sinh task khi tạo dự án — mọi việc do người dùng tự tạo & giao
  // (đúng user story US4). Template chỉ dùng để GỢI Ý phòng ban + áp thủ công ở trang "Quy trình & Template".

  await logAudit(payload.userId, 'CREATE', 'Project', project.id, { projectCode, projectName, linkedFiles: linkedCount }, getClientIP(req))

  // Invalidate project and dashboard caches
  await Promise.all([
    cacheInvalidate(CACHE_KEYS.projects),
    cacheInvalidate(CACHE_KEYS.dashboard),
  ])

  return successResponse({ project }, 'Dự án đã được khởi tạo thành công', 201)
})
