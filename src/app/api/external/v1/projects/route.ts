import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401)
  if (!requireScope(client, 'read:projects')) return errorResponse('Insufficient scope', 403)

  const params = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!params.success) return errorResponse('Invalid query parameters', 400)

  const { status, q, page, pageSize } = params.data

  const where: Record<string, unknown> = {}
  if (status === 'active') where.status = 'ACTIVE'
  if (q) {
    where.OR = [
      { projectCode: { contains: q, mode: 'insensitive' } },
      { projectName: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: { id: true, projectCode: true, projectName: true, status: true },
      orderBy: { projectCode: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.count({ where }),
  ])

  return successResponse({ data: projects, page, pageSize, total })
}
