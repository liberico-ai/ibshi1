import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP, getUserProjectIds } from '@/lib/auth'
import { initializeProjectWorkflow, completeTask } from '@/lib/workflow-engine'

// GET /api/projects — List all projects
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const search = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))

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

    return successResponse({
      projects: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('GET /api/projects error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// POST /api/projects — Create new project
export async function POST(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    if (!['R01', 'R02'].includes(payload.roleCode)) {
      return errorResponse('Bạn không có quyền tạo dự án', 403)
    }

    const body = await req.json()
    const { projectCode, projectName, clientName, productType,
            contractValue, currency, startDate, endDate, description,
            draftId } = body

    if (!projectCode || !projectName || !clientName || !productType) {
      return errorResponse('Thiếu thông tin bắt buộc: mã dự án, tên, khách hàng, loại sản phẩm')
    }

    const existing = await prisma.project.findUnique({ where: { projectCode } })
    if (existing) return errorResponse(`Mã dự án ${projectCode} đã tồn tại`)

    const project = await prisma.project.create({
      data: {
        projectCode,
        projectName,
        clientName,
        productType,
        contractValue: contractValue ? parseFloat(contractValue) : null,
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

    // Auto-initialize 32-step workflow
    await initializeProjectWorkflow(project.id)

    // P1.1 = "Tạo dự án" — auto-complete since creating the project IS step P1.1
    const p1Task = await prisma.workflowTask.findFirst({
      where: { projectId: project.id, stepCode: 'P1.1' },
    })
    if (p1Task) {
      const resultData = linkedCount > 0 ? { linkedFiles: linkedCount } : undefined
      await completeTask(p1Task.id, payload.userId, resultData, 'Tự động hoàn thành khi tạo dự án')
    }

    await logAudit(payload.userId, 'CREATE', 'Project', project.id, { projectCode, projectName, linkedFiles: linkedCount }, getClientIP(req))

    return successResponse({ project }, 'Dự án đã được khởi tạo thành công', 201)
  } catch (err) {
    console.error('POST /api/projects error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
