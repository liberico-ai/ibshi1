import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'
import { createTask } from '@/lib/work-engine'
import { ROLES } from '@/lib/constants'

export const dynamic = 'force-dynamic'

// ── GET: Polling — tasks updated since a given timestamp ──

const pollQuerySchema = z.object({
  updatedSince: z.string().datetime({ message: 'updatedSince phải là ISO 8601' }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401)
  if (!requireScope(client, 'read:tasks')) return errorResponse('Insufficient scope', 403)

  const params = pollQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!params.success) {
    const msg = params.error.issues.map(i => i.message).join('; ')
    return errorResponse(msg, 400)
  }

  const { updatedSince, page, pageSize } = params.data
  const since = new Date(updatedSince)

  const where = {
    updatedAt: { gte: since },
    externalRef: { not: null },
    externalSource: 'sale',
  }

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        project: { select: { projectCode: true, projectName: true } },
        assignees: true,
      },
      orderBy: { updatedAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.task.count({ where }),
  ])

  const userIds = tasks.flatMap(t => t.assignees.map(a => a.userId)).filter((uid): uid is string => !!uid)
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, fullName: true } })
    : []
  const nameById = new Map(users.map(u => [u.id, u.fullName]))

  const data = tasks.map(task => {
    const rd = (task.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
    const briefing = (rd.briefing && typeof rd.briefing === 'object') ? (rd.briefing as Record<string, unknown>) : {}
    const decision = typeof briefing.decision === 'string' ? briefing.decision : ''
    return {
      taskId: task.id,
      externalRef: task.externalRef,
      projectCode: task.project?.projectCode || null,
      projectName: task.project?.projectName || null,
      title: task.title,
      status: task.status,
      blocked: task.blocked,
      priority: task.priority || 'NORMAL',
      assignees: task.assignees.map(a => ({
        userId: a.userId || null,
        fullName: a.userId ? (nameById.get(a.userId) || null) : null,
        roleCode: a.role,
      })),
      deadline: task.deadline,
      decision,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt || null,
    }
  })

  return successResponse({ data, page, pageSize, total })
}

// ── POST: Create task from external system ──

const assigneeSchema = z.object({
  userId: z.string().optional(),
  role: z.string().optional(),
  email: z.string().email().optional(),
}).refine(a => a.userId || a.role || a.email, { message: 'assignee cần userId, role, hoặc email' })

const bodySchema = z.object({
  externalRef: z.string().min(1, 'externalRef là bắt buộc'),
  projectCode: z.string().min(1, 'projectCode là bắt buộc'),
  title: z.string().min(1, 'title là bắt buộc'),
  description: z.string().optional(),
  assignee: assigneeSchema,
  deadline: z.string().optional(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
})

async function getApiSystemUserId(): Promise<string> {
  let user = await prisma.user.findUnique({ where: { username: 'api-system' } })
  if (!user) {
    const { hashPassword } = await import('@/lib/auth')
    user = await prisma.user.create({
      data: {
        username: 'api-system',
        fullName: 'API System',
        roleCode: 'R10',
        passwordHash: await hashPassword(crypto.randomUUID()),
        isActive: true,
      },
    })
  }
  return user.id
}

export async function POST(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401)
  if (!requireScope(client, 'write:tasks')) return errorResponse('Insufficient scope', 403)

  let body: unknown
  try { body = await req.json() } catch { return errorResponse('Invalid JSON body', 400) }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => i.message).join('; ')
    return errorResponse(msg, 400)
  }

  const { externalRef, projectCode, title, description, assignee, deadline, priority } = parsed.data

  // Idempotency: if externalRef already exists, return existing task
  const existing = await prisma.task.findUnique({
    where: { externalRef },
    select: { id: true, externalRef: true, status: true, createdAt: true },
  })
  if (existing) {
    return successResponse({
      data: { taskId: existing.id, externalRef: existing.externalRef, status: existing.status, createdAt: existing.createdAt },
    })
  }

  // Resolve project
  const project = await prisma.project.findFirst({
    where: { projectCode },
    select: { id: true, projectCode: true, projectName: true },
  })
  if (!project) return errorResponse(`Dự án "${projectCode}" không tồn tại`, 404)

  // Resolve assignee
  const taskAssignees: { userId?: string; role?: string }[] = []

  if (assignee.email) {
    const user = await prisma.user.findFirst({ where: { email: assignee.email, isActive: true } })
    if (!user) return errorResponse(`Không tìm thấy người dùng với email "${assignee.email}"`, 404)
    taskAssignees.push({ userId: user.id })
  } else if (assignee.userId) {
    const user = await prisma.user.findUnique({ where: { id: assignee.userId }, select: { id: true, isActive: true } })
    if (!user) return errorResponse('userId không tồn tại', 404)
    if (!user.isActive) return errorResponse('Người dùng đã bị vô hiệu hóa', 400)
    taskAssignees.push({ userId: user.id })
  } else if (assignee.role) {
    if (!(assignee.role in (ROLES as Record<string, unknown>))) {
      return errorResponse(`Role "${assignee.role}" không hợp lệ`, 400)
    }
    taskAssignees.push({ role: assignee.role })
  }

  const systemUserId = await getApiSystemUserId()

  try {
    const task = await createTask({
      title,
      description,
      projectId: project.id,
      taskType: 'FREE',
      priority,
      deadline,
      assignees: taskAssignees.map((a, i) => ({ ...a, isPrimary: i === 0 })),
    }, systemUserId, { externalRef, externalSource: 'sale', externalClientId: client.id })

    console.log(`[ExternalAPI] Task created: ${task.id} externalRef=${externalRef} by client=${client.name}`)

    return successResponse({
      data: { taskId: task.id, externalRef, status: task.status, createdAt: task.createdAt },
    }, undefined, 201)
  } catch (err: unknown) {
    const prismaErr = err as { code?: string }
    if (prismaErr.code === 'P2002') {
      const race = await prisma.task.findUnique({
        where: { externalRef },
        select: { id: true, externalRef: true, status: true, createdAt: true },
      })
      if (race) {
        return successResponse({
          data: { taskId: race.id, externalRef: race.externalRef, status: race.status, createdAt: race.createdAt },
        })
      }
    }
    throw err
  }
}
