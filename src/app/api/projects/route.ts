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

    // Support both JSON and FormData (when files are attached)
    const contentType = req.headers.get('content-type') || ''
    let projectCode: string, projectName: string, clientName: string, productType: string
    let contractValue: string | null = null, currency: string | null = null
    let startDate: string | null = null, endDate: string | null = null, description: string | null = null
    let savedFiles: Record<string, string[]> = {}

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      projectCode = formData.get('projectCode') as string
      projectName = formData.get('projectName') as string
      clientName = formData.get('clientName') as string
      productType = formData.get('productType') as string
      contractValue = formData.get('contractValue') as string | null
      currency = formData.get('currency') as string | null
      startDate = formData.get('startDate') as string | null
      endDate = formData.get('endDate') as string | null
      description = formData.get('description') as string | null

      // Save uploaded files — wrapped in try/catch so file failures
      // do NOT block project creation (e.g. read-only FS on Docker)
      try {
        const { writeFile, mkdir } = await import('fs/promises')
        const path = await import('path')
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'projects', projectCode || 'temp')
        await mkdir(uploadDir, { recursive: true })

        const fileKeys = ['file_rfq', 'file_po', 'file_contract', 'file_spec']
        for (const key of fileKeys) {
          const files = formData.getAll(key) as File[]
          if (files && files.length > 0) {
            savedFiles[key] = []
            for (let i = 0; i < files.length; i++) {
              const file = files[i]
              if (file.size > 0) {
                // Add index/timestamp to prevent overwrite if multiple files have same name
                const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
                const uniqueName = files.length > 1 ? `${i}_${safeName}` : safeName
                const filePath = path.join(uploadDir, `${key}_${uniqueName}`)
                const buffer = Buffer.from(await file.arrayBuffer())
                await writeFile(filePath, buffer)
                savedFiles[key].push(`/uploads/projects/${projectCode}/${key}_${uniqueName}`)
              }
            }
          }
        }
      } catch (fsErr) {
        // File save failed (e.g. read-only FS on Docker). Log but continue —
        // the project record itself will still be created successfully.
        console.warn('POST /api/projects: file save skipped (FS error):', fsErr)
        savedFiles = {}
      }
    } else {

      const body = await req.json()
      projectCode = body.projectCode
      projectName = body.projectName
      clientName = body.clientName
      productType = body.productType
      contractValue = body.contractValue
      currency = body.currency
      startDate = body.startDate
      endDate = body.endDate
      description = body.description
    }

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

    // Auto-initialize 32-step workflow
    await initializeProjectWorkflow(project.id)

    // P1.1 = "Tạo dự án" — auto-complete since creating the project IS step P1.1
    // Store attached files in P1.1's resultData so P1.1B can display them
    const p1Task = await prisma.workflowTask.findFirst({
      where: { projectId: project.id, stepCode: 'P1.1' },
    })
    if (p1Task) {
      const resultData = typeof savedFiles !== 'undefined' && Object.keys(savedFiles).length > 0
        ? { attachedFiles: savedFiles }
        : undefined
      await completeTask(p1Task.id, payload.userId, resultData, 'Tự động hoàn thành khi tạo dự án')
    }

    await logAudit(payload.userId, 'CREATE', 'Project', project.id, { projectCode, projectName }, getClientIP(req))

    return successResponse({ project }, 'Dự án đã được khởi tạo thành công', 201)
  } catch (err) {
    console.error('POST /api/projects error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
