import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'
import { ROLES } from '@/lib/constants'
import { ROLE_TO_DEPT, DEPT_NAME } from '@/lib/org-map'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().optional(),
  projectCode: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:assignees')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const params = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!params.success) return errorResponse('Invalid query parameters', 400, 'VALIDATION_FAILED')

  const { q } = params.data

  const userWhere: Record<string, unknown> = { isActive: true }
  if (q) {
    userWhere.OR = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { username: { contains: q, mode: 'insensitive' } },
    ]
  }

  const users = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, fullName: true, roleCode: true, email: true },
    orderBy: { fullName: 'asc' },
    take: 100,
  })

  const userList = users.map(u => ({
    userId: u.id,
    fullName: u.fullName,
    roleCode: u.roleCode,
    deptName: DEPT_NAME[ROLE_TO_DEPT[u.roleCode] || ''] || null,
    email: u.email,
  }))

  const roles = Object.entries(ROLES as Record<string, { code: string; name: string }>).map(
    ([, r]) => ({ roleCode: r.code, name: r.name })
  )

  return successResponse({ data: { users: userList, roles } })
}
