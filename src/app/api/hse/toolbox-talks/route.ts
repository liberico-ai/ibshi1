import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'
import { validateBody } from '@/lib/api-helpers'
import { createToolboxTalkSchema } from '@/lib/schemas'

const WRITE_ROLES = ['R01', 'R10', 'R06', 'R06a', 'R06b']

export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()

  const url = new URL(req.url)
  const departmentId = url.searchParams.get('departmentId') || undefined

  const where: Record<string, unknown> = {}
  if (departmentId) where.departmentId = departmentId

  const talks = await prisma.toolboxTalk.findMany({
    where,
    include: {
      department: { select: { code: true, name: true } },
    },
    orderBy: { talkDate: 'desc' },
  })

  return successResponse({ talks })
}

export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, WRITE_ROLES)) return errorResponse('Không có quyền', 403)

  const result = await validateBody(req, createToolboxTalkSchema)
  if (!result.success) return result.response
  const data = result.data

  const count = await prisma.toolboxTalk.count()
  const talkCode = `TBT-${String(count + 1).padStart(4, '0')}`

  const talk = await prisma.toolboxTalk.create({
    data: {
      talkCode,
      departmentId: data.departmentId || null,
      talkDate: new Date(data.talkDate),
      topic: data.topic,
      content: data.content || null,
      attendees: data.attendees,
      conductedBy: user.userId,
      notes: data.notes || null,
    },
    include: { department: { select: { code: true, name: true } } },
  })

  return successResponse({ talk }, undefined, 201)
}
